import readline from 'readline';
import { google } from 'googleapis';
import * as Sentry from '@sentry/node';
import * as fs from 'fs';

import logger from '@/logger';

const TOKEN_PATH = 'keys/google-token.json';
const SCOPE = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.send',
];

class Google {
  auth = null;
  tokens = null;

  constructor() {
    console.log('setup google');
    this.setup()
      .then(() => {
        console.log('google auth complete :)');
      })
      .catch(err => {
        console.log('google auth fail :(', err);
      });
  }

  getAuth = () => this.auth;
  getTokens = () => this.tokens;

  setup = () =>
    new Promise((resolve, reject) => {
      if (this.auth && this.tokens) resolve(this.tokens);

      const oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_APP_ID,
        process.env.GOOGLE_APP_SECRET,
        'https://developers.google.com/oauthplayground' // Redirect URL
        // 'http://localhost:3000'
      );

      console.log('oAuth2Client', !!oAuth2Client);

      let tokens;

      // Check if we have previously stored a token.
      fs.readFile(TOKEN_PATH, 'utf8', async (err, _tokens) => {
        let rawTokens = _tokens;

        if (err || !_tokens) {
          console.log('sorry gotta get a new token dude');

          rawTokens = this.initTokens(oAuth2Client);
        } else console.log('using existing gmail tokens');

        // console.log('rawTokens', rawTokens);

        // try {
        tokens = JSON.parse(rawTokens || '');

        if (!tokens) return reject(new Error('No token found'));
        // } catch (erro) {
        //   console.log('erro', erro);
        // }

        if (!tokens.refresh_token)
          tokens.refresh_token = process.env.GMAIL_REFRESH;

        oAuth2Client.setCredentials(tokens);
        this.auth = oAuth2Client;
        this.tokens = tokens;
        oAuth2Client.on('tokens', this.handleNewTokens);

        return resolve();
      });
    });

  initTokens = oAuth2Client =>
    new Promise((resolve, reject) => {
      const authUrl = oAuth2Client.generateAuthUrl({
        scope: SCOPE,
        access_type: 'offline',
      });

      console.log('Authorize this app by visiting this url:', authUrl);
      logger.info(`Authorize this app by visiting this url: ${authUrl}`);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question('Enter the code from that page here: ', async code => {
        rl.close();

        try {
          console.log('getToken', code);
          const { tokens } = await oAuth2Client.getToken(code);

          console.log('setting credentials');
          oAuth2Client.setCredentials(tokens);

          this.tokens = tokens;

          fs.writeFile(TOKEN_PATH, JSON.stringify(tokens), err => {
            if (err) console.error(err);
            else console.log('Tokens stored in', TOKEN_PATH);
          });

          resolve(tokens);
        } catch (err) {
          logger.error('Error retrieving access token', err);
        }

        reject();
      });
    });

  refreshTokens = () =>
    new Promise((resolve, reject) => {
      console.log('attempting refresh...');
      try {
        this.auth.refreshAccessToken((err, newTokens) => {
          console.log('newTokens', err, newTokens);
          if (newTokens) {
            this.tokens = newTokens;
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(newTokens), err => {
              if (err) console.error(err);
              else console.log('Tokens stored in', TOKEN_PATH);
            });
          }

          resolve(newTokens);
        });
      } catch (err) {
        logger.error(err);
        Sentry.captureException(err);
      }
    });

  handleNewTokens = newTokens => {
    console.log('ding! newTokens!', newTokens);
    logger.info('ding! newTokens!');
    if (newTokens) {
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(newTokens), err => {
        if (err) console.error(err);
        else console.log('Tokens stored in', TOKEN_PATH);
      });
    }
  };
}

export default new Google();
