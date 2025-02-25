# session-tracker-api

Backend for session-tracker

## Project installation

- `sudo git clone https://github.com/alexcru1012/session-tracker.git`
- `cd session-tracker-api`
- `sudo git remote set-url origin git@github.com:alexcru1012/session-tracker.git`
- install vagrant, ansible
- `vagrant plugin install vagrant-vbguest`
- `vagrant up`
- `vagrant vbguest`
- `vagrant up --provision`
- If yum errors, ssh and run `sudo yum --disablerepo=\* --enablerepo=base,updates update`
- `vagrant reload`
- `npm install`
- `cp .env.sample .env`
- Edit .env file

## Run the project

- `npm start`

## Development

- `npm run dev`

## Production

- `nvm exec 12.14.1 npm run production-pm2` to start pm2 process
- or
- `nvm exec 12.14.1 npm run build`
- `nvm exec 12.14.1 npm run production-preview` to run server inline

## Update production

- `git pull`
- `npm run build`
- `pm2 restart prod`

## Redis installation

- none :)

## Postgres installation

- [tutorial](https://codingbee.net/tutorials/postgresql/postgresql-install-postgresql-and-then-create-a-db-and-user-account)
- `cd /var/lib/pgsql`
- `sudo -u postgres /usr/pgsql-12/bin/initdb -d /var/lib/pgsql/12/data`
- `sudo -u postgres /usr/pgsql-12/bin/createdb sessiontracker`
- `sudo -u postgres psql`
- `\password postgres` to change password
- `create user sessionuser with password 'laptop';`
- `grant all privileges on database "sessiontracker" to sessionuser;`
- `\c sessiontracker`
- `\i /vagrant/database/schema.sql`
- `\i /vagrant/database/seed.sql` for dummy data
- `CREATE EXTENSION citext;` to install citext type
- `\q` to quit
- `sudo vi /var/lib/pgsql/12/data/postgresql.conf`
- Uncomment `listen_addresses = '*'`
- Get address from welcome message after vagrant ssh and save/quit
- `sudo vi /var/lib/pgsql/12/data/pg_hba.conf`
- Add `host all all {MY IP ADDRESS}/32 trust`
- `sudo service postgresql-12 restart`
- `psql -h 127.0.0.1 -U sessionuser -d sessiontracker` to connect with correct user
- OR...
- Use pgAdmin GUI on macos
- Use port-forwarded port specified in Vagrantfile
- Update postgresql.conf and change `listen_addresses = '*'`
- Update pg_hba.conf and add `host all all 0.0.0.0/0 md5` to allow outside connections

## Mongo installation

- https://tecadmin.net/install-mongodb-on-centos/
- vi /etc/yum.repos.d/mongodb.repo
- sudo yum install mongodb-org
- sudo yum install mongodb-mongosh
- sudo chown -R mongod:mongod /var/lib/mongo
- systemctl start mongod.service
- systemctl enable mongod.service
- service mongod restart

## Mongo cli

- `mongo` in terminal
- `use sessiontracker`
- `db.getCollectionNames()`
- `db.usermetas.find().limit(1).pretty()`
- `db.usermetas.find({ stripeCustomerId: '' }).limit(1).pretty()`
- `exit`

## Stripe

- `stripe login`
- `stripe listen --forward-to localhost:3000/payment/webhook`
- `stripe trigger checkout.session.completed`

## Production postgres backups

- cd /
- sudo mkdir backups
- cd backups
- sudo mkdir postgres
- cd /var/www/session-tracker-api
- `sudo sh ./scripts/backup.sh`
- Create root ~/.pgpass with localhost:5432:mydbname:postgres:mypass Then chmod 600 ~/.pgpass

## Restore postgres from backup

- `cd /backups/postgres`
- `sudo gzip -d sessiontracker_DATE.tar.gz`
- `sudo -u postgres /usr/pgsql-12/bin/pg_restore --verbose --clean -h localhost -U postgres -F tar --create -d sessiontracker sessiontracker_DATE.tar`

## Production redis backups

- `sudo cp /var/lib/redis/dump.rdb /home/nico/dump.rdb`
- Stop redis, replace dump.rdb on new server, change file permissions, restart

## Upgrade postgres (example from 9.6 -> 12)

- `sudo yum list installed postgres*`
- `pm2 stop session-tracker-api`
- `sudo yum -y install postgresql12-server postgresql12-contrib`
- As postgres `sudo su postgres`
  - `cd ~`
  - `/usr/pgsql-9.6/bin/pg_ctl -D /var/lib/pgsql/9.6/data/ -mf stop`
  - `/usr/pgsql-12/bin/pg_upgrade --old-bindir /usr/pgsql-9.6/bin --new-bindir /usr/pgsql-12/bin --old-datadir /var/lib/pgsql/9.6/data --new-datadir /var/lib/pgsql/12/data --link --check`
  - `/usr/pgsql-12/bin/pg_upgrade --old-bindir /usr/pgsql-9.6/bin --new-bindir /usr/pgsql-12/bin --old-datadir /var/lib/pgsql/9.6/data --new-datadir /var/lib/pgsql/12/data --link`
  - `exit`
- `sudo service postgresql-9.6 stop`
- `sudo service postgresql-12 start`
- `sudo yum remove postgresql96 postgresql96-contrib postgresql96-devel postgresql96-libs postgresql96-server`
- Now you can run `sh ./analyze_new_cluster.sh` in postgres ~/
- the end

## Crontab

- `crontab -e` to edit
- 15 3 \* \* \* /usr/bin/certbot renew --quiet
- _/30 _ \* \* \* /usr/bin/bash /var/www/session-tracker-api/scripts/health.sh >> /backups/postgres/health-errors.txt 2>&1
- -------- Add this one to postgres user crontab:
- 0 1 \* \* \* /usr/bin/bash /var/www/session-tracker-api/scripts/backup.sh >> /backups/postgres/backup-errors.txt 2>&1
- 0 0 \* \* \* /usr/bin/bash /var/www/session-tracker-api/scripts/restart.sh >> /backups/node/restart-errors.txt
- `sudo chgrp postgres /backup/postgres/backup-errors.txt`
- `sudo chgrp postgres /backup/postgres/health-errors.txt`
- `sudo chmod 0664 backup-errors.txt`
- `sudo chmod 0664 health-errors.txt`

## Postgres migration

- `\c sessiontracker`
- `\i /vagrant?/database/schema.sql` (if adding new tables)
- `\i /vagrant?/database/migrate.sql`

## PGSQL info

- `sudo -u postgres psql` to connect
- `\l` to list dbs
- `\c` to connect to a db
- `\d` to describe db or table
- `\i` to read file
- `\q` to quit

## Redis info

- `redis-cli` to connect
- `set key1 "hello"`
- `del key1`
- `get key1`
- `keys *` to list keys
- `flushdb` or `flushall` to delete all keys
- Get count of 60-day active users
  - `redis-cli --scan --pattern 'st__activeUser__*' | wc -l`
- Clear endpoint caches
  - `redis-cli --scan --pattern 'hots__*' | xargs redis-cli del`

## Staging redis db

- semanage port -a -t redis_port_t -p tcp 6380
- **Copy directory**
- `mkdir -p /var/lib/redis-staging/`
- `chown redis /var/lib/redis-staging/`
- `chgrp redis /var/lib/redis-staging/`
- **Copy config**
- `cp /etc/redis.conf /etc/redis-staging.conf`
- `chown redis /etc/redis-staging.conf`
- **Edit config**
- `logfile "/var/log/redis/redis-staging.log"`
- `dir "/var/lib/redis-staging"`
- `pidfile "/var/run/redis/redis-staging.pid"`
- `port 6380`
- **Create service file**
- `cp /usr/lib/systemd/system/redis.service /usr/lib/systemd/system/redis-staging.service`
- **Edit redis-staging.service**
- `[Service]`
- `ExecStart=/usr/bin/redis-server /etc/redis-staging.conf --supervised systemd`
- `ExecStop=/usr/bin/redis-shutdown redis-staging`
- **Start service**
- `systemctl enable redis-staging`
- `sudo -u redis /usr/bin/redis-server /etc/redis-staging.conf`
- `sudo -u redis service redis-staging restart`
- **Check port**
- `lsof -i:6380`
- **Open redis-cli**
- `redis-cli -p 6380`
- `cat /etc/redis-staging.conf`
- `supervised systemd`
- `pidfile /var/run/redis-staging.pid`

## Git on server

- mkdir /var/www/session-tracker-api
- `git remote set-url origin git@github.com:alexcru1012/session-tracker.git`
- `git clone https://.../session-tracker-api.git`
- add id_rsa keys to ~/.ssh for git/gitlab
- chmod 600 id_rsa
- eval `ssh-agent -s`
- `ssh-add` in ~/.ssh

## Nginx

- `vi /etc/nginx/conf.d/api.mysessiontracker.com.conf`
- `sudo service nginx restart`
- If 502 bad gateway, and permission denied in /var/log/nginx/error.log
- Disable SELinux
  - `setsebool -P httpd_can_network_connect 1`

## Letsencrypt

- `sudo chmod -R 0775 /var/lib/letsencrypt/` (make writeable)


## Fail2ban

- sudo fail2ban-client status
- sudo fail2ban-client status nginx-404
- sudo fail2ban-client set nginx-404 unbanip 1.2.3.4
