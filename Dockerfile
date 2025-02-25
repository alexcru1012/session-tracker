FROM node:16

WORKDIR /server/

COPY package.json package-lock.json* /server/

RUN npm i

COPY . .

ENV AWS_ACCESS_KEY_ID=xxxx
ENV AWS_SECRET_ACCESS_KEY=xxxx
ENV AWS_DEFAULT_REGION=us-east-1

ENV PORT = "3000"

EXPOSE 3000
CMD [ "npm", "run", "start"]
