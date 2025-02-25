#!/bin/bash

# A simple script to perform postgres db backup.

DATE=$(date +"%Y%m%d%H%M")
# Dev /usr/pgsql-9.6/bin/pg_dump
# Production /usr/bin/pg_dump
PG_PATH=/usr/pgsql-12/bin
BIN=/usr/bin

cd /backups/postgres

PGPASSFILE=/home/postgres/.pgpass $PG_PATH/pg_dump -h localhost -U postgres --no-password -c -F t sessiontracker > sessiontracker_${DATE}.tar
# pg_dump -h localhost -U postgres -c -F t sessiontracker > sessiontracker_${DATE}.tar

$BIN/gzip sessiontracker_${DATE}.tar
# gzip sessiontracker_${DATE}.tar

# Cleanup configuration backups older than 30 days. 
# You can comment or adjust this if you donot want to delete old backups.

find /backups/postgres -name "sessiontracker*.gz" -mtime +30 -type f -delete
