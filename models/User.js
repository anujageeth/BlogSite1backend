import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  dateOfBirth: { type: Date, required: true },
  profilePicture: { type: String, default: '' },
  about: { type: String, default: '' }, // Add this field
  subscribers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

userSchema.pre('remove', async function(next) {
  try {
    const userId = this._id;

    // Delete all posts and their associated comments
    const userPosts = await this.model('Post').find({ author: userId });
    for (const post of userPosts) {
      await this.model('Comment').deleteMany({ post: post._id });
    }
    await this.model('Post').deleteMany({ author: userId });

    // Delete all comments made by the user
    await this.model('Comment').deleteMany({ author: userId });

    // Delete all notifications related to the user
    await this.model('Notification').deleteMany({
      $or: [
        { 'sender._id': userId },
        { recipient: userId }
      ]
    });

    // Remove user from subscribers lists
    await this.model('User').updateMany(
      { subscribers: userId },
      { $pull: { subscribers: userId } }
    );

    next();
  } catch (err) {
    next(err);
  }
});

export default mongoose.model('User', userSchema);
