require('dotenv').config(); // Load keys from .env
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 1. CONFIG CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- 2. SETUP STORAGE ENGINE ---
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Determine file type
    const isVideo = file.mimetype.startsWith('video');
    
    return {
      folder: `watchparty/${req.body.room}`, // Store in folder: watchparty/roomName
      resource_type: isVideo ? 'video' : 'image',
      public_id: file.originalname.split('.')[0], // Keep original name (no extension)
      format: isVideo ? 'mp4' : 'jpg', // Normalize formats
    };
  },
});

const upload = multer({ storage: storage });

// --- 3. SERVER SETUP ---
app.use(express.static('public'));

const peerServer = ExpressPeerServer(server, { debug: true });
app.use('/peerjs', peerServer);

// --- 4. UPLOAD ENDPOINT ---
// Cloudinary handles the "renaming" logic automatically if public_id matches
const uploadFields = upload.fields([{ name: 'videoFile', maxCount: 1 }, { name: 'imageFile', maxCount: 1 }]);

app.post('/upload', uploadFields, (req, res) => {
  if (!req.files || !req.files['videoFile']) return res.status(400).json({ error: "Video is required" });
  
  // File is already in cloud! We just send back success.
  res.json({ status: 'ok' });
});

// --- 5. LIBRARY ENDPOINT (Updated for Cloud) ---
app.get('/files', async (req, res) => {
  const room = req.query.room;
  if (!room) return res.json([]);

  try {
    // Search Cloudinary for files in this folder
    const result = await cloudinary.search
      .expression(`folder:watchparty/${room}`)
      .sort_by('public_id', 'desc')
      .max_results(50)
      .execute();

    // Group matching Video + Image
    // Result format: { video: "https://res.cloudinary...", image: "https://res.cloudinary..." }
    const resources = result.resources;
    
    // Filter out just the videos
    const videos = resources.filter(r => r.resource_type === 'video');
    
    const library = videos.map(vid => {
       // Look for an image with the same public_id (filename)
       const matchingImg = resources.find(r => r.resource_type === 'image' && r.public_id === vid.public_id);
       
       return {
         video: vid.secure_url, // This is the Web URL
         image: matchingImg ? matchingImg.secure_url : null,
         title: vid.public_id.split('/').pop() // Get clean name
       };
    });

    res.json(library);

  } catch (err) {
    console.error("Cloudinary Error:", err);
    res.json([]);
  }
});

// --- 6. SOCKET IO (Unchanged) ---
const connectedUsers = {}; 
io.on('connection', (socket) => {
  socket.on('join_room', (data) => {
    socket.join(data.room);
    connectedUsers[socket.id] = { room: data.room, peerId: data.peerId, username: data.username };
    socket.to(data.room).emit('user_connected', data);
    
    const clients = io.sockets.adapter.rooms.get(data.room);
    if (clients && clients.size > 1) {
        const firstUser = [...clients].find(id => id !== socket.id);
        if (firstUser) io.to(firstUser).emit('ask_time', socket.id); 
    }
    socket.to(data.room).emit('notification', `${data.username} joined!`);
  });

  socket.on('sync_time', (data) => io.to(data.userToSync).emit('get_time', data.time));
  socket.on('send_message', (msg) => {
    const user = connectedUsers[socket.id];
    if (user) io.to(user.room).emit('receive_message', { user: user.username, text: msg });
  });

  socket.on('disconnect', () => {
    const user = connectedUsers[socket.id];
    if (user) {
      socket.to(user.room).emit('user_disconnected', user.peerId);
      socket.to(user.room).emit('notification', `${user.username} left.`);
      delete connectedUsers[socket.id];
    }
  });

  socket.on('play_video', (room) => socket.to(room).emit('play_video'));
  socket.on('pause_video', (room) => socket.to(room).emit('pause_video'));
  socket.on('seek_video', (data) => socket.to(data.room).emit('seek_video', data.time));
  socket.on('change_movie', (data) => {
     io.to(data.room).emit('change_movie', data);
     const user = connectedUsers[socket.id];
     io.to(data.room).emit('notification', `${user ? user.username : 'Someone'} changed the movie`);
  });
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});