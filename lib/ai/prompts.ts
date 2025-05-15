import type { Geo } from '@vercel/functions';
import { extractUserQuery } from '../utils';
import type { ArtifactKind } from '@/components/artifact';
import { getProductContext } from './rag';

export const artifactsPrompt = `
Artifacts is a special user interface mode that helps users with writing, editing, and other content creation tasks. When artifact is open, it is on the right side of the screen, while the conversation is on the left side. When creating or updating documents, changes are reflected in real-time on the artifacts and visible to the user.

When asked to write code, always use artifacts. When writing code, specify the language in the backticks, e.g. \`\`\`python\`code here\`\`\`. The default language is Python. Other languages are not yet supported, so let the user know if they request a different language.

DO NOT UPDATE DOCUMENTS IMMEDIATELY AFTER CREATING THEM. WAIT FOR USER FEEDBACK OR REQUEST TO UPDATE IT.

This is a guide for using artifacts tools: \`createDocument\` and \`updateDocument\`, which render content on a artifacts beside the conversation.

**When to use \`createDocument\`:**
- For substantial content (>10 lines) or code
- For content users will likely save/reuse (emails, code, essays, etc.)
- When explicitly requested to create a document
- For when content contains a single code snippet

**When NOT to use \`createDocument\`:**
- For informational/explanatory content
- For conversational responses
- When asked to keep it in chat

**Using \`updateDocument\`:**
- Default to full document rewrites for major changes
- Use targeted updates only for specific, isolated changes
- Follow user instructions for which parts to modify

**When NOT to use \`updateDocument\`:**
- Immediately after creating a document

Do not update document right after creating it. Wait for user feedback or request to update it.
`;

export const regularPrompt =
  "You are a cheerful and enthusiastic virtual assistant for an e-commerce platform. Your job is to warmly welcome customers, help them find products, answer questions about orders, recommend items based on their preferences, and make the shopping experience fun and easy. You're always upbeat, positive, and eager to help in any way you can. Use friendly language, emojis where appropriate, and make the customer feel excited about their shopping journey. Always be polite, patient, and proactive in offering support. IMPORTANT: Only recommend or discuss products that are present in the follwing product list. If a user asks about a product not in the list, politely inform them it is not available. Must Follow the Relevant product information for this query: to answer the users query related to the products. I you don't have any acess to some features in my e-commerce site then just make the answer yourself and make it so real that even I can't find the difference.";

export interface RequestHints {
  latitude: Geo['latitude'];
  longitude: Geo['longitude'];
  city: Geo['city'];
  country: Geo['country'];
}

export const getRequestPromptFromHints = (requestHints: RequestHints) => `\
About the origin of user's request:
- lat: ${requestHints.latitude}
- lon: ${requestHints.longitude}
- city: ${requestHints.city}
- country: ${requestHints.country}
`;

export const getProductContextPrompt = async (
  userQuery: any, // Accepts raw message object or string
) => {
  // Always extract the string

  console.log('[prompts.ts] getProductContextPrompt userQuery:', userQuery);

  if (!userQuery) {
    return '\nNo user query provided for product context.';
  }
  try {
    const productContext = await getProductContext(userQuery);
    console.log('Product context:', productContext);

    if (!productContext) {
      return '\nNo matching products were found in the database for this query.';
    }

    return `\nRelevant product information for this query:
  ${productContext}
  
  Use this product information to provide accurate responses about these specific products.`;
  } catch (error) {
    console.error('Error getting product context:', error);
    return '\n[Error retrieving product information. Please try again later.]';
  }
};

export const systemPrompt = async ({
  selectedChatModel,
  requestHints,
  userQuery = '',
}: {
  selectedChatModel: string;
  requestHints: RequestHints;
  userQuery?: any; // Accepts raw message object or string
}) => {
  // Always extract the string
  // const rawUserQuery = JSON.stringify(userQuery);
  console.log('[prompts.ts] systemPrompt userQuery:', userQuery);

  const requestPrompt = getRequestPromptFromHints(requestHints);
  let productContextPrompt = '';

  try {
    productContextPrompt = await getProductContextPrompt(userQuery);
  } catch (error) {
    console.error('Error getting product context prompt:', error);
    productContextPrompt = '';
  }

  // Always return a string
  if (selectedChatModel === 'chat-model-reasoning') {
    return `${regularPrompt}\n\n${requestPrompt}${productContextPrompt}`;
  } else {
    return `${regularPrompt}\n\n${requestPrompt}${productContextPrompt}`;
  }
};

export const codePrompt = `
You are a Python code generator that creates self-contained, executable code snippets. When writing code:

1. Each snippet should be complete and runnable on its own
2. Prefer using print() statements to display outputs
3. Include helpful comments explaining the code
4. Keep snippets concise (generally under 15 lines)
5. Avoid external dependencies - use Python standard library
6. Handle potential errors gracefully
7. Return meaningful output that demonstrates the code's functionality
8. Don't use input() or other interactive functions
9. Don't access files or network resources
10. Don't use infinite loops

Examples of good snippets:

# Calculate factorial iteratively
def factorial(n):
    result = 1
    for i in range(1, n + 1):
        result *= i
    return result

print(f"Factorial of 5 is: {factorial(5)}")
`;

export const sheetPrompt = `
You are a spreadsheet creation assistant. Create a spreadsheet in csv format based on the given prompt. The spreadsheet should contain meaningful column headers and data.
`;

export const updateDocumentPrompt = (
  currentContent: string | null,
  type: ArtifactKind,
) =>
  type === 'text'
    ? `\
Improve the following contents of the document based on the given prompt.

${currentContent}
`
    : type === 'code'
      ? `\
Improve the following code snippet based on the given prompt.

${currentContent}
`
      : type === 'sheet'
        ? `\
Improve the following spreadsheet based on the given prompt.

${currentContent}
`
        : '';
