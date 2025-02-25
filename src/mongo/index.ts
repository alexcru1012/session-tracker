import mongoose from 'mongoose';

import logger from '@/logger';

const options = {
  autoIndex: false, // Don't build indexes
  maxPoolSize: 10, // Maintain up to 10 socket connections
  // serverSelectionTimeoutMS: 4000, // Keep trying to send operations for 4 seconds
  socketTimeoutMS: 30000, // Close sockets after 30 seconds of inactivity
  family: 4, // Use IPv4, skip trying IPv6
  useUnifiedTopology: false,
  useNewUrlParser: true,
  localThresholdMS: 1000,
};

const connection = mongoose
  .connect(
    `mongodb://127.0.0.1:${process.env.MONGO_PORT}/${process.env.MONGO_DB}`,
    options
  )
  .catch((error: Error) => {
    logger.error('Mongoose error: ', error);
  });

mongoose.connection
  .once('connected', () => {
    logger.info('Connected to mongo');
  })
  .on('error', error => {
    logger.error(`Mongoose error: ${error.stack || error}`);
  });

export default connection;
