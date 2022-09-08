import { WebClient } from "@slack/web-api";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";

import SpotifyWebApi from "spotify-web-api-node";
import YoutubeMusicApi from "youtube-music-api";

const wc = new WebClient(process.env.SLACK_TOKEN);
const {
  KID: kid,
  ISS: iss,
  MUSIC_PRIVATE_KEY: APPLE_MUSIC_PRIVATE_KEY,
} = process.env;

export async function handler(requestEvent) {
  if (!requestEvent.body) {
    return {
      statusCode: 400,
      body: `Missing body`,
    };
  }

  const body = JSON.parse(requestEvent.body);
  if (body.challenge) {
    return {
      statusCode: 200,
      body: body.challenge,
    };
  }

  const { event, token } = body;
  if (event) {
    const { type } = event;
    if (type === `link_shared`) handleLinkShared(event, token);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ hello: `world` }),
  };
}

async function handleLinkShared(event, token) {
  try {
    const { links } = event;

    const url = new URL(links[0].url);
    if (url.hostname === `music.apple.com`)
      handleAppleMusicRequest(event, token, url);
  } catch (error) {
    console.log(error);
  }
}

async function handleAppleMusicRequest(event, token, url) {
  const user = await wc.users.info({ user: event.user });
  const {
    name: username,
    profile: { image_original: avatar_url },
  } = user.user;

  const api = new AppleMusicAPI();

  const queryParams = url.searchParams;
  const trackIdentifier = queryParams.get(`i`);
  const { data } = await api.getTrack(trackIdentifier);
  const track = data[0];
  const {
    attributes: { name, artistName: artist },
  } = track;

  const youtubeApi = new YouTubeMusicAPI();
  const youtubeLink = await youtubeApi.search(
    `${name}, ${artist.split(`&`).join()}`
  );
  wc.chat.postMessage({
    token: process.env.SLACK_TOKEN,
    channel: event.channel,
    thread_ts: event.message_ts,
    text: youtubeLink,
    username,
    icon_url: avatar_url,
  });

  const spotifyApi = new SpotifyAPI();
  const spotifyLink = await spotifyApi.search(`${name} artist:${artist}`);
  wc.chat.postMessage({
    token: process.env.SLACK_TOKEN,
    channel: event.channel,
    thread_ts: event.message_ts,
    text: spotifyLink,
    username,
    icon_url: avatar_url,
  });
}

class SpotifyAPI {
  constructor() {
    this._token = undefined;
    this.api = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: `https://willsonsmith.com`,
    });
  }

  async search(query) {
    await this.token();
    const {
      body: {
        tracks: { items },
      },
    } = await this.api.searchTracks(query);
    const track = items[0];
    return track.external_urls.spotify;
  }

  async token() {
    if (this._token) return this._token;
    const {
      body: { access_token },
    } = await this.api.clientCredentialsGrant();
    this.api.setAccessToken(access_token);
    this._token = access_token;
    return access_token;
  }
}

class YouTubeMusicAPI {
  constructor() {
    this.api = new YoutubeMusicApi();
  }

  async search(term) {
    try {
      await this.api.initalize();
      const result = await this.api.search(term, `song`);
      const videoId = result.content[0].videoId;
      return `https://music.youtube.com/watch?v=${videoId}`;
    } catch (error) {
      console.log(error);
    }
  }
}

class AppleMusicAPI {
  constructor() {
    this._token = this.token();
  }

  async getTrack(trackIdentifier) {
    const url = `https://api.music.apple.com/v1/catalog/ca/songs/${trackIdentifier}`;
    const headers = {
      Authorization: `Bearer ${this._token}`,
    };
    const response = await fetch(url, { headers });
    const data = await response.json();
    return data;
  }

  token() {
    if (this._token) return this._token;
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;
    const payload = { iss, iat, exp };
    //@ts-ignore
    this._token = jwt.sign(payload, APPLE_MUSIC_PRIVATE_KEY, {
      algorithm: `ES256`,
      header: { kid },
    });
    return this._token;
  }
}
