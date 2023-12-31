import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";


export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
   
    // S3 Buckets
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // Tables
    const imagesTable = new dynamodb.Table(this, "ImagesTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "ImageName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Images",
    });
  
       // Integration infrastructure

      const imageRejectionQueue = new sqs.Queue(this, "image-rejection-dlq", {
          queueName: "RejectionDLQ",
      });

      const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
        receiveMessageWaitTime: cdk.Duration.seconds(10),
        deadLetterQueue: {
          queue: imageRejectionQueue,
          maxReceiveCount: 1,
        },
        retentionPeriod: cdk.Duration.seconds(60),
      });

      const newImageTopic = new sns.Topic(this, "NewImageTopic", {
          displayName: "New Image topic",
        }); 

  // Lambda functions
  const confirmationMailerFn = new lambdanode.NodejsFunction(this, "ConfirmationMailerFn", {
    runtime: lambda.Runtime.NODEJS_18_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
  });

  const rejectionMailerFn = new lambdanode.NodejsFunction(this, "RejectionMailerFn", {
    runtime: lambda.Runtime.NODEJS_18_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
  });

  newImageTopic.addSubscription(new subs.LambdaSubscription(confirmationMailerFn));
   
  newImageTopic.addSubscription(
    new subs.SqsSubscription(imageProcessQueue)
  );

 

  const processImageFn = new lambdanode.NodejsFunction(
    this,
    "ProcessImageFn",
    {
    
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      deadLetterQueue: imageRejectionQueue,
    }
  );

  const processDeleteFn = new lambdanode.NodejsFunction(this, "process-delete-function", {
    runtime: lambda.Runtime.NODEJS_18_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/processDelete.ts`,
  });

  newImageTopic.addSubscription(
    new subs.LambdaSubscription(processDeleteFn)
  );

  const processUpdateFn = new lambdanode.NodejsFunction(this, "process-update-function", {
    runtime: lambda.Runtime.NODEJS_18_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/processUpdate.ts`,
  });
  
  newImageTopic.addSubscription(
    new subs.LambdaSubscription(processUpdateFn, {
      filterPolicy: {
        'comment_type': 
        sns.SubscriptionFilter.stringFilter({
          allowlist: ["Caption"]
      })
    }
  }
));

  // Event triggers
  imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
  );

  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_REMOVED,
    new s3n.SnsDestination(newImageTopic)
  );

  const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });

  processImageFn.addEventSource(newImageEventSource);

  const newRejectionEventSource = new events.SqsEventSource(imageRejectionQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(10),
    maxConcurrency: 5
  });

  rejectionMailerFn.addEventSource(newRejectionEventSource);

  
  // Permissions
  imagesBucket.grantRead(processImageFn);
  imagesTable.grantReadWriteData(processImageFn);
  imagesTable.grantReadWriteData(processDeleteFn);
  imagesTable.grantReadWriteData(processUpdateFn);

    confirmationMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    rejectionMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    // Output

    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });
  }
}
