/* eslint-disable import/extensions, import/no-absolute-path */
import {SNSHandler} from "aws-lambda";
import {S3Client} from "@aws-sdk/client-s3";
import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import {UpdateCommand, DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();
const s3 = new S3Client();

export const handler: SNSHandler = async (event : any) => {
    console.log("Event ", event);
    for (const snsRecord of event.Records) {
        const snsMessage = JSON.parse(snsRecord.Sns.Message);
        const messageName = snsMessage.name;
        const messageDescription = snsMessage.description;

        if (snsMessage.Records) {
            console.log(" SNS Record ", JSON.stringify(snsMessage));
            for (const messageRecord of snsMessage.Records) {
                const s3e = messageRecord.s3;
                const srcBucket = s3e.bucket.name;

                const updateCommand = new UpdateCommand({
                    //process.env.TABLE_NAME,
                    TableName: "Images",
                    Key: {
                        ImageName: messageName
                    },
                    UpdateExpression: "SET Description = :d",
                    ExpressionAttributeValues: {
                        ":d": messageDescription
                    }
                });

                await ddbDocClient.send(updateCommand);
            }
        };
    }
}

function createDDbDocClient() {
    const ddbClient = new DynamoDBClient({region: process.env.REGION});
    const marshallOptions = {
        convertEmptyValues: true,
        removeUndefinedValues: true,
        convertClassInstanceToMap: true
    };
    const unmarshallOptions = {
        wrapNumbers: false
    };
    const translateConfig = {
        marshallOptions,
        unmarshallOptions
    };
    return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}