import mongoose from 'mongoose';

const usageSchema = new mongoose.Schema({
  userId: {
    type: 'Number',
    unique: true,
  },
  dates: {
    type: 'Object',
    default: {},
  },
});

/* eslint-disable func-names */
/* eslint-disable no-param-reassign */
/* eslint-disable no-nested-ternary */
/** Return array of sorted dates */
usageSchema.methods.getDateKeys = function() {
  return Object.keys(this.dates).sort(function(a, b) {
    // YYYY-MM-DD to YYYYMMDD
    a = a
      .split('-')
      .reverse()
      .join('');
    b = b
      .split('-')
      .reverse()
      .join('');

    return a > b ? 1 : a < b ? -1 : 0;
  });
};

const Usage = mongoose.model('Usage', usageSchema);

export default Usage;
