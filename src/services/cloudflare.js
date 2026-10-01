import { config } from 'dotenv';
import { S3Client, ListBucketsCommand, CreateBucketCommand, DeleteBucketCommand, PutObjectCommand, ListObjectsCommand, HeadBucketCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
config();


class CloudflareIntegration {
    constructor(region = "auto") {
        this.region = ['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc', 'auto'].includes(region) ? region : 'auto';
        this.s3Client = new S3Client({
            region: this.region,
            endpoint: process.env.s3_api_url,
            credentials: {
                accessKeyId: process.env.cloudflare_access_key_id,
                secretAccessKey: process.env.cloudflare_secret_access_key
            }
        });
    }
    // async getZones() {
    //     const response = await axios.get('https://api.cloudflare.com/client/v4/zones', {
    //         headers: {
    //             'Authorization': `Bearer ${this.apiKey}`
    //         }
    //     });
    // }
    // async listBuckets(input = {}) {
    //     try {
    //         const command = new ListBucketsCommand(input);
    //         const response = await this.s3Client.send(command);
    //         console.log(JSON.stringify(response, null, 2));
    //         return response;
    //         // {
    //         //     "Buckets": [],
    //         //     "Owner": {
    //         //       "DisplayName": "1ef55aedd933961b26225ce0c3c7aa33",
    //         //       "ID": "1ef55aedd933961b26225ce0c3c7aa33"
    //         //     },
    //         //     "$metadata": {
    //         //       "httpStatusCode": 200,
    //         //       "attempts": 1,
    //         //       "totalRetryDelay": 0
    //         //     }
    //         //   }
    //     } catch (error) {
    //         console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
    //         throw error;
    //     }
    // }
    async createBucket(input = {}) {
        try {
            const command = new CreateBucketCommand(input);
            const response = await this.s3Client.send(command);
            return response;
        } catch (error) {
            console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
            throw error;
        }
    }
    // async deleteBucket(input = {}) {
    //     try {
    //         const command = new DeleteBucketCommand(input);
    //         const response = await this.s3Client.send(command);
    //         console.log(JSON.stringify(response, null, 2));
    //         return response;
    //     } catch (error) {
    //         console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
    //         throw error;
    //     }
    // }
    // async uploadFile(input = {}) {
    //     try {
    //         const command = new PutObjectCommand(input);
    //         const response = await this.s3Client.send(command);
    //         console.log(JSON.stringify(response, null, 2));
    //         return response;
    //     }
    //     catch (error) {
    //         console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
    //         throw error;
    //     }
    // }
    async createTemporaryUploadURL(input = {}) {
        try {
            const command = new PutObjectCommand(input);
            const url = await getSignedUrl(this.s3Client, command, { expiresIn: 600 }); // 600 seconds = 10 minutes
            return url;
        } catch (error) {
            console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
            throw error;
        }
    }
    async listObjects(input = {}) {
        try {
            const command = new ListObjectsV2Command(input);
            const response = await this.s3Client.send(command);
            return response;
        }
        catch (error) {
            console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
            throw error;
        }
    }
    async getBucketSize(input = {}) {
        try {
            let totalSize = 0, continuationToken;
            do {
                const command = new ListObjectsV2Command({ ...input, ContinuationToken: continuationToken });
                const response = await this.s3Client.send(command);
                if (response.Contents?.length > 0) for (const obj of response.Contents) totalSize += Number(obj.Size);
                continuationToken = response.NextContinuationToken;
            } while (continuationToken);
            const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
            const sizeGB = (totalSize / (1024 * 1024 * 1024)).toFixed(2);
            return { bytes: totalSize, MB: sizeMB, GB: sizeGB };
        }
        catch (error) {
            console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
            throw error;
        }
    }
    async generateDownloadURL(input = {}, { expiresIn = 600 } = {}) {
        try {
            const command = new GetObjectCommand(input);
            // R2 signed URLs cannot outlive 7 days.
            const lifetime = Math.min(Math.max(Number(expiresIn) || 600, 1), 60 * 60 * 24 * 7);
            const url = await getSignedUrl(this.s3Client, command, { expiresIn: lifetime });
            return url;
        }
        catch (error) {
            console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
            throw error;
        }
    }
    async deleteObject(input = {}) {
        try {
            const command = new DeleteObjectCommand(input);
            const response = await this.s3Client.send(command);
            return response;
        }
        catch (error) {
            console.error({ name: error.name, code: error.Code, message: error.message, metadata: error.$metadata });
            throw error;
        }
    }
}

export const cloudflareIntegration = new CloudflareIntegration();