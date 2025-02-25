#!/bin/bash

# Get status using curl
status=$(curl --silent --write-out %{http_code} --output /dev/null https://api.mysessiontracker.com)

if [[ "$status" -ne 200 ]] ; then
  # Send an email
  echo -e "Server health status check at \n\n$(date) \n\nreported:\n\n${status} \n\nPlease restart the node server, thanks." | mailx -A gmail -s "Server health check FAILED" -c nicotroia@gmail.com sessiontrackerpro@gmail.com
fi

exit 0
