import mongoose from 'mongoose';

const kittenSchema = new mongoose.Schema({
  name: String,
  names: [String],
});

/* eslint-disable func-names */
kittenSchema.methods.meow = function() {
  console.log('meow');
};

const Kitten = mongoose.model('Kitten', kittenSchema);

export default Kitten;
