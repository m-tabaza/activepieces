import { createAction } from '../../../framework/action/action';
import { Property } from '../../../framework/property';
import { telegramCommons } from '../common';
import { httpClient } from '../../../common/http/core/http-client';
import { HttpMethod } from '../../../common/http/core/http-method';

export const telegramSendMessageAction = createAction({
    name: 'send_text_message',
    description: 'Send a message through a Telegram bot',
    displayName: 'Send Text Message',
    props: {
        bot_token: telegramCommons.bot_token,
        chat_id: Property.ShortText({
            displayName: 'Chat Id',
            description: "To send a message to a specific chat, you will need to provide either the unique identifier for the chat or the username of a public chat (formatted as @channelusername). If you want to send a message to a private user, check (https://activepieces.com/docs/pieces/apps/telegram) on how to obtain the chat id",
            required: true,
        }),
        message: Property.LongText({
            displayName: 'Message',
            description: 'The message to be sent',
            required: true,
        })
    },
    sampleData: {},
    async run(ctx) {
        return await httpClient.sendRequest<never>({
            method: HttpMethod.POST,
            url: telegramCommons.getApiUrl(ctx.propsValue['bot_token']!, 'sendMessage'),
            body: {
                chat_id: ctx.propsValue['chat_id']!,
                text: ctx.propsValue['message']!,
            },
        });
    },
});