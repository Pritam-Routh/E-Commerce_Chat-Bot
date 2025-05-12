import {
  appendClientMessage,
  appendResponseMessages,
  createDataStream,
  smoothStream,
  streamText,
} from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  getStreamIdsByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { generateUUID, getTrailingMessageId } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import type { Chat } from '@/lib/db/schema';
import { initializeRAG } from '@/lib/ai/rag';
import fs from 'fs';
import path from 'path';

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

// Initialize RAG system when the server starts
let ragInitialized = false;
async function ensureRAGInitialized() {
  if (!ragInitialized) {
    try {
      await initializeRAG();
      ragInitialized = true;
    } catch (error) {
      console.error('Failed to initialize RAG system:', error);
    }
  }
}

// Setup logging directory
const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create logs directory:', error);
  }
}

// Logging function for chat interactions
function logChatInteraction(
  type: 'USER' | 'MODEL',
  chatId: string,
  userId: string,
  content: any,
) {
  try {
    const timestamp = new Date().toISOString();
    const logFileName = path.join(
      LOG_DIR,
      `chat_logs_${new Date().toISOString().split('T')[0]}.log`,
    );

    const logEntry = JSON.stringify(
      {
        timestamp,
        type,
        chatId,
        userId,
        content,
      },
      null,
      2,
    );

    fs.appendFileSync(logFileName, logEntry + '\n---\n');

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[CHAT LOG] ${type} - ${timestamp} - ${chatId.substring(0, 8)}...`,
      );
    }
  } catch (error) {
    console.error('Failed to log chat interaction:', error);
  }
}

function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message?.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      } else {
        console.error('Error creating resumable stream context:', error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  // Ensure RAG is initialized
  await ensureRAGInitialized();
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    console.error('Invalid request body:', error);
    return new Response('Invalid request body', { status: 400 });
  }

  try {
    const { id, message, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const session = await auth();

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userType: UserType = session.user.type;
    const userId = session.user.id;

    // Log user message
    logChatInteraction('USER', id, userId, {
      message,
      selectedChatModel,
      selectedVisibilityType,
    });

    const messageCount = await getMessageCountByUserId({
      id: userId,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new Response(
        'You have exceeded your maximum number of messages for the day! Please try again later.',
        {
          status: 429,
        },
      );
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== userId) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const previousMessages = await getMessagesByChatId({ id });

    const messages = appendClientMessage({
      // @ts-expect-error: todo add type conversion from DBMessage[] to UIMessage[]
      messages: previousMessages,
      message,
    });

    // Get the latest user message for RAG context
    console.log('latestUserMessage', message);
    console.log('typeof Latestmessage:', typeof message);

    function parseLatestMessage(msg) {
      if (typeof msg !== 'object' || msg === null) {
        throw new TypeError('Expected an object for latestUserMessage');
      }

      const { id, createdAt, role, content, parts } = msg;

      // Convert createdAt to a Date instance if it's a string
      const timestamp =
        createdAt instanceof Date ? createdAt : new Date(createdAt);

      // Extract an array of just the text from parts
      const partTexts = Array.isArray(parts)
        ? parts.map((p, i) => {
            if (typeof p.text !== 'string') {
              console.warn(
                `Part at index ${i} missing text field or not a string`,
              );
              return '';
            }
            return p.text;
          })
        : [];

      return content;
    }

    const latestUserMessageMe = parseLatestMessage(message);
    console.log('latestUserMessage', latestUserMessageMe);
    console.log('typeof latestUserMessage:', typeof latestUserMessageMe);

    const latestUserMessage =
      messages.length > 0
        ? (messages[messages.length - 1].parts ?? []).join(' ')
        : '';

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts,
          attachments: message.experimental_attachments ?? [],
          createdAt: new Date(),
        },
      ],
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    // Create a buffer to collect the full model response
    let fullModelResponse = {
      parts: [],
      reasoning: null,
      attachments: [],
      id: null,
    };

    const stream = createDataStream({
      execute: async (dataStream) => {
        console.log(
          '[route.ts] latestUserMessage:',
          JSON.stringify(latestUserMessage),
        );
        const systemPromptString = await systemPrompt({
          selectedChatModel,
          requestHints,
          userQuery: latestUserMessageMe,
        });
        console.log('[route.ts] systemPromptString:', systemPromptString);
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPromptString,
          messages,
          maxSteps: 5,
          experimental_activeTools:
            selectedChatModel === 'chat-model-reasoning'
              ? []
              : [
                  'getWeather',
                  'createDocument',
                  'updateDocument',
                  'requestSuggestions',
                ],
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_generateMessageId: generateUUID,
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
          },
          onFinish: async ({ response }) => {
            if (session.user?.id) {
              try {
                const assistantId = getTrailingMessageId({
                  messages: response.messages.filter(
                    (message) => message.role === 'assistant',
                  ),
                });

                if (!assistantId) {
                  throw new Error('No assistant message found!');
                }

                const [, assistantMessage] = appendResponseMessages({
                  messages: [message],
                  responseMessages: response.messages,
                });

                // Log the complete model response
                fullModelResponse.id = assistantId;
                fullModelResponse.parts = assistantMessage.parts;
                fullModelResponse.attachments =
                  assistantMessage.experimental_attachments ?? [];

                // If there's reasoning, add it to the log
                const assistantMessageWithReasoning = response.messages.find(
                  (m) => m.role === 'assistant' && m.id === assistantId,
                );
                if (assistantMessageWithReasoning?.experimental_reasoning) {
                  fullModelResponse.reasoning =
                    assistantMessageWithReasoning.experimental_reasoning;
                }

                // Log the complete model response
                logChatInteraction('MODEL', id, userId, fullModelResponse);

                await saveMessages({
                  messages: [
                    {
                      id: assistantId,
                      chatId: id,
                      role: assistantMessage.role,
                      parts: assistantMessage.parts,
                      attachments:
                        assistantMessage.experimental_attachments ?? [],
                      createdAt: new Date(),
                    },
                  ],
                });
              } catch (error) {
                console.error('Failed to save chat:', error);
              }
            }
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        // // Collect response chunks for logging
        // result.on('text', (text) => {
        //   fullModelResponse.parts.push(text);
        // });

        // // Collect reasoning if available
        // result.on('reasoning', (reasoning) => {
        //   fullModelResponse.reasoning = reasoning;
        // });

        result.consumeStream();

        result.mergeIntoDataStream(dataStream, {
          sendReasoning: true,
        });
      },
      onError: (error) => {
        console.error('Stream error:', error);
        // Log the error
        logChatInteraction('MODEL', id, userId, {
          error: error.message || 'Unknown error',
          stack: error.stack,
        });
        return 'Oops, an error occurred while generating a response!';
      },
    });

    const streamContext = getStreamContext();

    // Handle both cases - with and without resumable stream context
    if (streamContext) {
      try {
        return new Response(
          await streamContext.resumableStream(streamId, () => stream),
        );
      } catch (error) {
        console.error('Failed to create resumable stream:', error);
        // Fall back to regular stream if resumable stream fails
        return new Response(stream);
      }
    } else {
      // No stream context available, use regular stream directly
      return new Response(stream);
    }
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}

export async function GET(request: Request) {
  const streamContext = getStreamContext();

  // If no stream context is available, return a more informative response
  if (!streamContext) {
    console.log('Stream context not available for GET request');
    return new Response(
      JSON.stringify({
        message: 'Resumable streams are not available',
        error: 'No stream context',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return new Response('id is required', { status: 400 });
  }

  const session = await auth();

  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  let chat: Chat;

  try {
    chat = await getChatById({ id: chatId });
  } catch (error) {
    console.error('Error fetching chat:', error);
    return new Response('Not found', { status: 404 });
  }

  if (!chat) {
    return new Response('Not found', { status: 404 });
  }

  if (chat.visibility === 'private' && chat.userId !== session.user.id) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const streamIds = await getStreamIdsByChatId({ chatId });

    if (!streamIds.length) {
      return new Response(JSON.stringify({ message: 'No streams found' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const recentStreamId = streamIds.at(-1);

    if (!recentStreamId) {
      return new Response(
        JSON.stringify({ message: 'No recent stream found' }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    const emptyDataStream = createDataStream({
      execute: () => {},
    });

    return new Response(
      await streamContext.resumableStream(
        recentStreamId,
        () => emptyDataStream,
      ),
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error('Error processing stream request:', error);
    return new Response(
      JSON.stringify({
        message: 'Error processing stream request',
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Forbidden', { status: 403 });
    }

    const deletedChat = await deleteChatById({ id });

    return Response.json(deletedChat, { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}
