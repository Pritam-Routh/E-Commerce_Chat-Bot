import type { ArtifactKind } from '@/components/artifact';
import type { Geo } from '@vercel/functions';
import { MongoClient, Db, Collection } from 'mongodb';

// MongoDB connection setup
const uri = process.env.MONGODB_URI ?? '';
let client: MongoClient | null = null;
let db: Db | null = null;

interface Collections {
  products: Collection;
  users: Collection;
  orders: Collection;
}

async function connectDB(): Promise<Db> {
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }

  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
    const dbName = process.env.MONGODB_DB_NAME;
    if (!dbName) {
      throw new Error('MONGODB_DB_NAME environment variable is not defined');
    }
    db = client.db(dbName);
  }

  if (!db) {
    throw new Error('Failed to connect to database');
  }

  return db;
}

// Collections
async function getCollections(): Promise<Collections> {
  const database = await connectDB();
  return {
    products: database.collection('products'),
    users: database.collection('users'),
    orders: database.collection('orders'),
  };
}

// Core service functions for e-commerce assistant
export async function searchProducts(query: string): Promise<any[]> {
  try {
    const { products } = await getCollections();
    return await products
      .find({
        $text: { $search: query },
      })
      .limit(10)
      .toArray();
  } catch (error) {
    console.error('Error searching products:', error);
    return [];
  }
}

export async function recommendProducts(userId: string): Promise<any[]> {
  try {
    const { users, products } = await getCollections();
    const user = await users.findOne({ _id: userId });
    const history =
      (user?.purchaseHistory as Array<{ category: string }>) || [];
    if (history.length) {
      const categories = history.map((o) => o.category);
      return await products
        .find({ category: { $in: categories } })
        .limit(5)
        .toArray();
    }
    return await products.find().sort({ rating: -1 }).limit(5).toArray();
  } catch (error) {
    console.error('Error recommending products:', error);
    return [];
  }
}

export async function getOrderDetails(orderId: string): Promise<any | null> {
  try {
    const { orders } = await getCollections();
    return await orders.findOne({ _id: orderId });
  } catch (error) {
    console.error('Error getting order details:', error);
    return null;
  }
}

/**
 * Search for similar products by image.
 * This function accepts an image URL or base64 string,
 * extracts descriptive labels via a vision service,
 * and performs a text-based search on those labels.
 */
export async function searchProductsByImage(imageUrl: string): Promise<any[]> {
  try {
    // TODO: integrate with a vision/ML service to extract labels
    // For example:
    // const labels: string[] = await visionService.extractLabels(imageUrl);
    // const query = labels.join(' ');
    // return await searchProducts(query);

    // Placeholder implementation: treat imageUrl as a keyword
    return await searchProducts(imageUrl);
  } catch (error) {
    console.error('Error searching products by image:', error);
    return [];
  }
}

// Prompt templates tailored for e-commerce assistant
export const artifactsPrompt = `
Artifacts is a special user interface mode that helps users with writing, editing, and other content creation tasks in real time. When artifact is open, it is on the right side of the screen, while the conversation is on the left side. Changes to documents or code snippets appear immediately.

When asked to write or update e-commerce code or documents, always use artifacts. Specify the language in backticks (e.g. \`\`\`typescript\`\`\`).

DO NOT UPDATE DOCUMENTS IMMEDIATELY AFTER CREATING THEM. WAIT FOR USER FEEDBACK OR REQUEST TO UPDATE.
`;

export const regularPrompt = `
You are a cheerful and enthusiastic e-commerce assistant. You help customers search for products, recommend personalized items, answer order queries, find similar products by image, and guide users through their shopping journey. Always be upbeat, positive, and eager to assist. Use friendly language, emojis, and clear explanations to make the experience delightful.

Use these functions when needed:
- searchProducts(query: string)
- searchProductsByImage(imageUrl: string)
- recommendProducts(userId: string)
- getOrderDetails(orderId: string)

When you need data, respond with a function call. Otherwise, craft a warm, informative reply.`;

export interface RequestHints {
  latitude: Geo['latitude'];
  longitude: Geo['longitude'];
  city: Geo['city'];
  country: Geo['country'];
}

export const getRequestPromptFromHints = (requestHints: RequestHints): string =>
  `About the user's location for contextual responses:\n- lat: ${requestHints.latitude}\n- lon: ${requestHints.longitude}\n- city: ${requestHints.city}\n- country: ${requestHints.country}`;

export const systemPrompt = ({
  selectedChatModel,
  requestHints,
}: {
  selectedChatModel: string;
  requestHints: RequestHints;
}): string => {
  const requestPrompt = getRequestPromptFromHints(requestHints);

  if (selectedChatModel === 'chat-model-reasoning') {
    return `${regularPrompt}\n\n${requestPrompt}`;
  } else {
    return `${regularPrompt}\n\n${requestPrompt}\n\n${artifactsPrompt}`;
  }
};

// TypeScript code generation prompt for e-commerce tasks
export const codePrompt = `
You are a TypeScript code generator focused on e-commerce assistant functionality. When writing code:
1. Include necessary imports (e.g., MongoDB helpers or API clients)
2. Provide complete, runnable snippets
3. Use clear comments describing each step
4. Handle errors gracefully (e.g., try/catch)
5. Interact with searchProducts, searchProductsByImage, recommendProducts, or getOrderDetails when relevant
6. Keep snippets concise (under 20 lines)

Examples of good snippets:
\`\`\`typescript
// Example: Fetch and display top recommendations for a user
async function showRecommendations(userId: string) {
  try {
    const recs = await recommendProducts(userId);
    console.log('Recommended for you:', recs);
  } catch (err) {
    console.error('Failed to fetch recommendations', err);
  }
}
\`\`\`

// Example: Find similar products by image
\`\`\`typescript
async function findSimilarByImage(imageUrl: string) {
  const results = await searchProductsByImage(imageUrl);
  console.log('Products like your image:', results);
}
\`\`\`
`;

// CSV spreadsheet prompt for e-commerce data
export const sheetPrompt = `
You are an e-commerce spreadsheet assistant. Create CSV-formatted data for tasks such as product inventory, order summaries, user purchase history, or image-based search results. Include meaningful headers and realistic sample rows.
`;

export const updateDocumentPrompt = (
  currentContent: string | null,
  type: ArtifactKind,
): string => {
  if (type === 'text') {
    return `Improve the following e-commerce document based on the given prompt.\n\n${currentContent}`;
  } else if (type === 'code') {
    return `Improve the following e-commerce code snippet based on the given prompt.\n\n${currentContent}`;
  } else if (type === 'sheet') {
    return `Improve the following e-commerce spreadsheet based on the given prompt.\n\n${currentContent}`;
  }
  return '';
};

// OpenAI function definitions for assistant to call e-commerce backend services
export const functionDefinitions = [
  {
    name: 'searchProducts',
    description: 'Search for products in the catalog by keyword',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'searchProductsByImage',
    description: 'Find products similar to the uploaded image',
    parameters: {
      type: 'object',
      properties: {
        imageUrl: {
          type: 'string',
          description: 'URL or base64 string of the image',
        },
      },
      required: ['imageUrl'],
    },
  },
  {
    name: 'recommendProducts',
    description: 'Recommend personalized products for a user',
    parameters: {
      type: 'object',
      properties: { userId: { type: 'string' } },
      required: ['userId'],
    },
  },
  {
    name: 'getOrderDetails',
    description: 'Retrieve details for a specific order',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
  },
];
