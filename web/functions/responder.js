import { WebClient } from "@slack/web-api";
const wc = new WebClient(process.env.SLACK_TOKEN);
export async function handler(requestEvent) {
  if (requestEvent.body) {
    const body = JSON.parse(requestEvent.body);
    console.log(body);
    // const {event} = body;
    // const {token, challenge, type, event} = body;
    if (body.event) {
      const { channel } = body.event;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ hello: `world` }),
  };
}
