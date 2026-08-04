import { Collection } from '../../models/Collection.js';
import { Data } from '../../models/Data.js';
import { AgentModel } from '../../models/Agent.js';
import { User } from '../../models/User.js';
import graphqlFields from 'graphql-fields';
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { Business } from '../../models/Business.js';
import { cloudflareIntegration } from '../../services/cloudflare.js';
import { llamaParser } from '../../services/llamaparse.js';
import { firecrawlService } from '../../services/firecrawl.js';
export const collectionResolvers = {
    Query: {
        collections: async (_, { limit = 10, page = 1, id, isPublic }, context, info) => {
            const filter = {};
            filter.business = context.user.business;
            if (id) filter._id = id;
            if (isPublic !== undefined) filter.isPublic = isPublic;
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            let collections = await Collection.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select(rootFields);
            const totalDocuments = await Collection.countDocuments(filter);
            if (populateFields?.business) await Business.populate(collections, { path: 'business', select: populateFields.business });
            if (populateFields?.createdBy) await User.populate(collections, { path: 'createdBy', select: populateFields.createdBy });
            return { data: collections, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        getListOfUploadedFiles: async (_, { StartAfter, ContinuationToken, includeSize = false }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const listOfFiles = await cloudflareIntegration.listObjects({ Bucket: "ava-client-documents", Prefix: context.user.business.toString() + "/" });
            if (includeSize) listOfFiles.SizeUploaded = await cloudflareIntegration.getBucketSize({ Bucket: "ava-client-documents", Prefix: context.user.business.toString() + "/" });
            return listOfFiles;
        },
    },

    Mutation: {
        createCollection: async (_, { collection }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            let { name, description, source, chunkingDetails, webcrawler, parserDetails, isPublic, isFeatured } = collection;
            //webcrawler.options: {formats: ['markdown']}
            const newCollection = await Collection.create({ name, description, source, metaData: { chunkingDetails, parserDetails, webcrawler }, business: context.user.business, createdBy: context.user._id, isPublic, isFeatured });
            switch (source) {
                case "website":
                    const lastUpdate = await firecrawlService.startBatchScrape(webcrawler.urls, webcrawler.options, { collection_id: newCollection._id, business_id: context.user.business._id });
                    newCollection.metaData.webcrawler.lastUpdate = lastUpdate;
                    newCollection.metaData.webcrawler.jobId = lastUpdate.id;
                    newCollection.metaData.progressStages = [{ name: "webcrawler", status: "RUNNING", moreInfo: lastUpdate }, { name: "Chunking" }, { name: "embed and upsert" }];
                    break;
                case "youtube":
                    break;
                case "file":
                    const parsing = await llamaParser.parse(newCollection.metaData.parserDetails, { collection_id: newCollection._id });
                    newCollection.metaData.parserDetails.lastUpdate = parsing;
                    newCollection.metaData.parserDetails.jobId = parsing.id;
                    newCollection.metaData.progressStages = [{ name: "Parsing", status: "RUNNING", moreInfo: parsing }, { name: "Chunking" }, { name: "embed and upsert" }];
                    break;
            }
            // sendMessageToRoom(context.user.business.toString(), "collection-status", { collectionId: newCollection._id, status: "loading" }, "admin");
            // sendMessageToRoom(receiver.toString(), "adding-collection", { total: 1, progress: 0.3, collectionId: collectionId }, "admin");
            await newCollection.save();
            await Business.populate(newCollection, { path: 'business', select: nested.business });
            await User.populate(newCollection, { path: 'createdBy', select: nested.createdBy });
            // (async function processCollection(newCollection, receiver = context.user.business) {
            //     try {
            //         for (const content of newCollection.contents) {
            //             const { source, metaData, _id } = content;
            //             let result

            //             switch (source) {
            //                 case "website":
            //                     console.log("website process started");
            //                     if (metaData?.urls) result = await processURLS(newCollection._id, metaData.urls, receiver, _id);
            //                     break;
            //                 case "youtube":
            //                     console.log("youtube process started");
            //                     if (metaData?.urls) result = await processYT(newCollection._id, metaData.urls, receiver, _id);
            //                     break;
            //                 default:
            //                     console.warn(`Unknown source type: ${source}`);
            //                     break;
            //             }
            //         }
            //     } catch (error) {
            //         console.error("Failed to sync collection:", error);
            //     }
            // })(newCollection, receiver);
            return newCollection;
        },
        getUploadUrl: async (_, { key = "sampleDocument" }, context, info) => {
            const uploadUrl = await cloudflareIntegration.createTemporaryUploadURL({ Bucket: "ava-client-documents", Key: context.user.business.toString() + "/" + key });
            return uploadUrl;
        },
        getDownloadUrl: async (_, { key = "" }, context, info) => {
            const downloadUrl = await cloudflareIntegration.generateDownloadURL({ Bucket: "ava-client-documents", Key: context.user.business.toString() + "/" + key });
            return downloadUrl;
        },
        deleteUploadedFileFromStorage: async (_, { key = "" }, context, info) => {
            await cloudflareIntegration.deleteObject({ Bucket: "ava-client-documents", Key: context.user.business.toString() + "/" + key });
            return true;
        },
        updateCollection: async (_, { id, name, description }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            const updateFields = {};
            if (name !== undefined && name !== "") updateFields.name = name;
            if (description !== undefined && description !== "") updateFields.description = description;
            const collection = await Collection.findOneAndUpdate({ _id: id, business: context.user.business }, updateFields, { new: true });
            if (!collection) throw new GraphQLError("Collection not found", { extensions: { code: "COLLECTION_NOT_FOUND" } });
            await Business.populate(collection, { path: 'business', select: nested.business });
            await User.populate(collection, { path: 'createdBy', select: nested.createdBy });
            return collection;
        },
        deleteCollection: async (_, { id }, context) => {
            // const jobs = await urlProcessingQueue.getJobs(['waiting', 'active', 'delayed']);
            await Promise.all([
                Collection.findByIdAndDelete(id),
                AgentModel.updateMany({ collections: id, business: context.user.business }, { $pull: { collections: id } }),
                Data.deleteMany({ collection: id }),
                // ...jobs.filter(job => job.data.collectionId === id).map(job => job.remove())
            ])
            return true;
        }
    },
}; 