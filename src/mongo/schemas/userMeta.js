import mongoose from 'mongoose';

const userMetaSchema = new mongoose.Schema({
  userId: {
    type: 'Number',
    unique: true,
  },
  stripeSessionId: {
    type: 'String',
  },
  stripeCustomerId: {
    type: 'String',
  },
  stripeSubscriptionId: {
    type: 'String',
  },
  hasUnsubscribedFromEmails: {
    type: 'Boolean',
  },
  clientIdsWhoHaveUnsubscribed: {
    type: ['String'],
  },
  wasSentMissingEmail: {
    type: 'Date',
  },
  wasSentUpgradeSuccessEmail: {
    type: 'Date',
  },
  // shouldDisplayMobileAppTutorial: {
  //   type: 'Boolean',
  //   default: false,
  // },
});

/* eslint-disable func-names */
/** Unsubscribe client from recieving transactional emails */
userMetaSchema.methods.unsubscribeClient = function(clientId) {
  this.clientIdsWhoHaveUnsubscribed.push(clientId);
  this.save();
};

userMetaSchema.methods.unsubscribeClientMistake = function(clientId) {
  const index = this.clientIdsWhoHaveUnsubscribed.indexOf(String(clientId));
  if (index > -1) this.clientIdsWhoHaveUnsubscribed.splice(index, 1);

  this.save();
};

const UserMeta = mongoose.model('UserMeta', userMetaSchema);

export default UserMeta;
