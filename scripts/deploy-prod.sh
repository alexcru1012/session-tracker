cd /var/www/session-tracker-api
git pull origin master
git checkout -- package-lock.json
npm install
npm run build
pm2 restart prod
