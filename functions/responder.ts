import { Handler } from "@netlify/functions";
import { WebClient } from "@slack/web-api";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";

import SpotifyWebApi from "spotify-web-api-node";
/** NOTE
 * SpotifyWebApi uses `Buffer` which has been deprecated.
 */
import YoutubeMusicApi from "youtube-music-api";

const SLACK_TOKEN = process.env.SLACK_TOKEN;

const {
  KID: kid,
  ISS: iss,
  MUSIC_PRIVATE_KEY: APPLE_MUSIC_PRIVATE_KEY,
} = process.env;

const handler: Handler = async (requestEvent) => {
  if (requestEvent?.queryStringParameters?.url) {
    const url = new URL(requestEvent.queryStringParameters.url);
    console.log(url, "URL");
    const service = getServiceFromUrl(url);
    const trackId = getTrackId(service, url);
    const tracks = await getTrack({ id: trackId, service })
      .then(findTracks)
      .then((tracks: [string]) => {
        let urls = {};
        for (const track of tracks) {
          const url = new URL(track);
          const service = getServiceFromUrl(url);
          urls[service] = url.href;
        }
        return urls;
      });
    return {
      statusCode: 200,
      body: JSON.stringify(tracks),
    };
  }
  try {
    if (!requestEvent.body) {
      return {
        statusCode: 400,
        body: `Missing body`,
      };
    }

    const body = JSON.parse(requestEvent.body);
    if (body.challenge) {
      console.log(`Received challenge: ${body.challenge}`);
      return {
        statusCode: 200,
        body: body.challenge,
      };
    }

    const slack = new WebClient(SLACK_TOKEN);
    try {
      const { user } = await slack.users.info({ user: body.event.user });
      console.log(user, `user`);
      if (user.is_bot) return { statusCode: 200, body: `` };
    } catch (error) {
      console.log(`no user`);
      return { statusCode: 200, body: `` };
    }

    const url = getUrl(body.event);
    const service = getServiceFromUrl(url);
    const trackId = getTrackId(service, url);

    await getTrack({ id: trackId, service })
      .then(findTracks)
      .then((tracks) => {
        return sendMessages(tracks, body.event, slack);
      })
      .catch(console.log)
      .finally(() => {
        console.log(`Done`);
      });

    return { statusCode: 200, body: `` };
  } catch (error) {
    console.log(error);
  }
};

async function sendMessages(urls, event, slack) {
  const { user } = await slack.users.info({ user: event.user });
  const { channel } = event;
  const { name: username } = user;
  const {
    profile: { image_original: avatar },
  } = user;

  return Promise.allSettled(
    urls.map((message) => {
      return slack.chat.postMessage({
        channel,
        icon_url: avatar,
        text: message,
        thread_ts: event.message_ts,
        token: SLACK_TOKEN,
        username,
      });
    })
  );
}

function getUrl(event): URL {
  const { links } = event;
  const url = new URL(links[0].url);
  return url;
}

function getServiceFromUrl(url: URL): string {
  const { hostname } = url;
  if (hostname === `music.apple.com`) return `apple`;
  if (hostname === `open.spotify.com`) return `spotify`;
  if (hostname === `music.youtube.com`) return `youtube`;
}
function getTrackId(service: string, url: URL): string {
  if (service === `spotify`) return url.pathname.split(`/`)[2];
  if (service === `apple`) return url.searchParams.get(`i`);
  if (service === `youtube`) return url.searchParams.get(`v`);
}

function findTracks({ title, artist, from }) {
  const tracksToFind = [`spotify`, `apple`, `youtube`].filter(
    (service) => service !== from
  );
  return Promise.all(
    tracksToFind.map((service) => findTrack({ title, artist, service }))
  );
}

function findTrack({ title, artist, service }) {
  return new Promise((resolve, reject) => {
    if (service === `spotify`) {
      const spotifyApi = new SpotifyAPI();
      spotifyApi
        .search(`${title} artist:${artist}`)
        .then(resolve)
        .catch(reject);
    }
    if (service === `apple`) {
      const appleMusicApi = new AppleMusicAPI();
      appleMusicApi.search(`${title} ${artist}`).then(resolve).catch(reject);
    }
    if (service === `youtube`) {
      const youtubeMusicApi = new YoutubeMusicAPI();
      youtubeMusicApi.search(`${title} ${artist}`).then(resolve).catch(reject);
    }
  });
}

function getTrack({ id, service }) {
  if (service === `spotify`) {
    const api = new SpotifyAPI();
    return api.getTrack(id);
  }
  if (service === `apple`) {
    const api = new AppleMusicAPI();
    return api.getTrack(id);
  }
  if (service === `youtube`) {
    const api = new YoutubeMusicAPI();
    return api.getTrack(id);
  }
}

class SpotifyAPI {
  api: SpotifyWebApi;
  _token: string;
  constructor() {
    console.log(`Initializing Spotify API`);
    this._token = undefined;
    this.api = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: `https://willsonsmith.com`,
    });
  }

  async getTrack(id) {
    try {
      await this.token();
      const track = await this.api.getTrack(id);
      const title = track.body.name;
      const artist = track.body.artists[0].name;
      return { title, artist, from: `spotify` };
    } catch (error) {
      console.log(`Failed to get track from Apple Music`, error);
    }
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

class YoutubeMusicAPI {
  api: YoutubeMusicApi;
  constructor() {
    console.log(`Initializing YouTube Music API`);
    this.api = new YoutubeMusicApi();
  }

  async getTrack(id) {
    try {
      await this.api.initalize();
      const result = await this.api.search(id, `song`);
      const song = result.content[0];
      const {
        name: title,
        artist: { name: artist },
      } = song;
      return { title, artist, from: `youtube` };
    } catch (error) {
      console.log(`Failed to get track from Apple Music`, error);
    }
  }

  async search(term) {
    await this.api.initalize();
    const result = await this.api.search(term, `song`);
    const videoId = result.content[0].videoId;
    return `https://music.youtube.com/watch?v=${videoId}`;
  }
}

class AppleMusicAPI {
  _token: string;
  baseUrl: string = `https://api.music.apple.com/v1/catalog/ca`;
  constructor() {
    console.log(`Initializing Apple Music API`);
    this._token = this.token();
  }

  async getTrack(trackIdentifier) {
    try {
      const url = `${this.baseUrl}/songs/${trackIdentifier}`;
      const headers = {
        Authorization: `Bearer ${this._token}`,
      };
      const response = await fetch(url, { headers });
      const { data } = await response.json();
      const track = data[0];
      const { attributes } = track;
      const { name: title, artistName: artist } = attributes;
      return { title, artist, from: `apple` };
    } catch (error) {
      console.log(`Failed to get track from Apple Music`, error);
    }
  }

  async search(query) {
    const searchParams = new URLSearchParams([[`term`, query]]);
    const response = await fetch(`${this.baseUrl}/search?${searchParams}`, {
      headers: {
        Authorization: `Bearer ${this._token}`,
      },
    });
    const data = await response.json();
    const {
      results: {
        songs: { data: songs },
      },
    } = data;
    const {
      attributes: { url },
    } = songs[0];
    return url;
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

export { handler };
