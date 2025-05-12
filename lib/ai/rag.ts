import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

// MongoDB setup
let mongoClient: MongoClient | null = null;
let productsCollection: any = null;

// Pinecone setup
const indexName = 'ecommerce-products-gemini-embeddings'; // or 'ecommerce-products' to match Python
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
let pineconeIndex = pinecone.index(indexName);

// Gemini setup
const GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Helper: Get Gemini embedding for a string
async function getGeminiEmbedding(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: 'models/gemini-embedding-exp-03-07',
    contents: text,
    // config: { taskType: 'SEMANTIC_SIMILARITY' },
  });
  return response.embeddings[0].values;
}

// At startup, check and create if needed
export async function ensurePineconeIndex() {
  // Defensive: Pinecone SDK may return array of strings or objects

  // const indexList = await pinecone.listIndexes();
  // if (!indexList.includes(indexName)) {
  //   await pinecone.createIndex({
  //     name: indexName,
  //     dimension: 3072, // Gemini embedding dimension
  //     metric: 'cosine',
  //     spec: {
  //       serverless: {
  //         cloud: 'aws',
  //         region: 'us-east-1',
  //       },
  //     },
  //     deletionProtection: 'disabled',
  //     tags: { environment: 'development' },
  //   });
  //   console.log(`Created Pinecone index: ${indexName}`);
  // } else {
  //   console.log(`Pinecone index already exists: ${indexName}`);
  // }
  pineconeIndex = pinecone.index(indexName);
}

// Initialize RAG system
export async function initializeRAG() {
  try {
    const uri = process.env.MONGODB_URI || '';
    if (!uri) {
      console.error('MONGODB_URI environment variable not set');
      return false;
    }
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    const db = mongoClient.db('ecommerce');
    productsCollection = db.collection('products');
    console.log(
      `Connected to MongoDB: ${await productsCollection.countDocuments()} products found`,
    );
    await ensurePineconeIndex();
    return true;
  } catch (error) {
    console.error('Failed to initialize RAG system:', error);
    return false;
  }
} // Only run this ONCE (or check if exists before creating)

// Index all products in Pinecone (run once or on product updates)
export async function indexProductsInPinecone() {
  // if (!productsCollection) throw new Error('MongoDB not initialized');
  // const products = await productsCollection.find().toArray();
  // for (const product of products) {
  //   const text = `${product.name ?? ''} ${product.description ?? ''}`;
  //   const embedding = await getGeminiEmbedding(text);
  //   await pineconeIndex.upsert([
  //     {
  //       id: String(product._id),
  //       values: embedding,
  //       metadata: {
  //         product_id: String(product._id),
  //         name: product.name,
  //         description: product.description,
  //         price: product.price,
  //         stock: product.stock,
  //         category: product.category,
  //       },
  //     },
  //   ]);
  // }
  console.log('Indexing complete.');
}

// Semantic search for products using Pinecone + Gemini
export async function getProductContext(userQuery: string, topK = 5) {
  if (!productsCollection) {
    console.error('MongoDB not initialized');
    return '';
  }
  try {
    // Enhanced debug logging
    console.log(
      '[prompts.ts] getProductContextPrompt userQuery:',
      JSON.stringify(userQuery),
    );
    const queryEmbedding = await getGeminiEmbedding(userQuery);
    const results = await pineconeIndex.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });

    if (!results.matches || results.matches.length === 0) {
      return '';
    }

    // Format the product information
    const productInfo = results.matches
      .map((match: any) => {
        const m = match.metadata;
        return `
Product ID: ${m.product_id}
Name: ${m.name}
Description: ${m.description || 'No description available'}
Price: ₹${m.price}
Stock: ${m.stock || 'Unknown'}
Category: ${m.category || 'Uncategorized'}
        `;
      })
      .join('\n---\n');

    return productInfo;
  } catch (error) {
    console.error('Error retrieving product context:', error);
    return '';
  }
}

// Clean up resources
export async function closeRAGConnections() {
  if (mongoClient) {
    await mongoClient.close();
  }
}
