import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
// import { xai } from '@ai-sdk/xai';
import { google } from '@ai-sdk/google';
import { isTestEnvironment } from '../constants';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': google('gemini-2.0-flash-lite'),
        'chat-model-reasoning': wrapLanguageModel({
          model: google('gemini-2.0-flash'),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'title-model': google('gemini-2.0-flash-lite'),
        'artifact-model': google('gemini-2.0-flash-lite'),
      },
      imageModels: {
        'small-model': google('gemini-2.0-flash', {
          maxImagesPerCall: 1,
        }),
      },
    });
