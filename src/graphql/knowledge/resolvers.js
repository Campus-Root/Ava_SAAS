import { Business, User, AgentModel } from '@avakado.ai/schemas';
import graphqlFields from 'graphql-fields';
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { cloudflareIntegration } from '../../services/cloudflare.js';
export const knowledgeResolvers = {
    Query: {
        getListOfUploadedFiles: async (_, { StartAfter, ContinuationToken, includeSize = false }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const listOfFiles = await cloudflareIntegration.listObjects({ Bucket: "ava-client-documents", Prefix: context.user.business.toString() + "/" });
            if (includeSize) listOfFiles.SizeUploaded = await cloudflareIntegration.getBucketSize({ Bucket: "ava-client-documents", Prefix: context.user.business.toString() + "/" });
            return listOfFiles;
        },
    },

    Mutation: {
        getUploadUrl: async (_, { key = "sampleDocument" }, context, info) => {
            const uploadUrl = await cloudflareIntegration.createTemporaryUploadURL({ Bucket: "ava-client-documents", Key: context.user.business.toString() + "/" + key });
            return uploadUrl;
        },
        getDownloadUrl: async (_, { key = "", neverExpire = false }, context, info) => {
            const downloadUrl = await cloudflareIntegration.generateDownloadURL(
                { Bucket: "ava-client-documents", Key: context.user.business.toString() + "/" + key },
                { expiresIn: neverExpire ? 60 * 60 * 24 * 7 : 600 },
            );
            return downloadUrl;
        },
        deleteUploadedFileFromStorage: async (_, { key = "" }, context, info) => {
            await cloudflareIntegration.deleteObject({ Bucket: "ava-client-documents", Key: context.user.business.toString() + "/" + key });
            return true;
        }
    },
}; 