import moment from 'moment';
import * as fs from 'fs';
import path from 'path';

import { Strings } from '@/constants';

const stylesheet = {
  css: fs.readFileSync('src/templates/styles.css', 'utf8'),
};

export const commonData = {
  appName: Strings.appName,
  appUrl: Strings.appUrl,
  stylesheet,
  supportEmail: String(process.env.SUPPORT_EMAIL),
  year: moment().format('YYYY'),
  showHeaderLogo: true,
  title: `A message from ${Strings.appName}`,
};

export const commonSmtpOptions = {
  attachments: [
    {
      filename: 'logo.png',
      path: path.join(__dirname, '../../public/images/logo-trans.png'),
      cid: 'header-logo',
    },
  ],
};

export default {};
