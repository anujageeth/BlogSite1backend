import mongoose from 'mongoose';

const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { 
    type: String, 
    required: true,
    set: function(content) {
      // Convert markdown-style formatting to HTML
      return content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/__(.*?)__/g, '<u>$1</u>');
    }
  },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  profilePicture: {
    type: String,
    default: ''
  },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  image: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

export default mongoose.model('Post', postSchema);
