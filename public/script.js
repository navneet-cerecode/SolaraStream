// public/script.js

const socket = io();
let myPeer = null;      
let myStream = null;    
let peers = {};         
let currentRoom = null;
let myUsername = "Anonymous";
let isSyncing = false;

// --- DOM ELEMENTS ---
const lobby = document.getElementById('lobby');
const videoRoom = document.getElementById('videoRoom');
const videoGrid = document.getElementById('videoGrid');
const mainMovie = document.getElementById('mainMovie');
const chatContainer = document.getElementById('chatContainer');

// --- JOIN LOGIC ---
document.getElementById('joinBtn').addEventListener('click', async () => {
  const room = document.getElementById('roomInput').value.trim();
  const user = document.getElementById('usernameInput').value.trim();
  
  if(!room || !user) return alert("Please enter both Room and Nickname.");
  currentRoom = room; 
  myUsername = user;

  try {
    // Get Camera & Mic
    myStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    addVideoToGrid(myStream, 'me', myUsername); 
  } catch (e) { 
    console.warn("Camera denied or not found:", e); 
    showToast("⚠️ Joined without Camera");
  }

  // Connect to PeerJS
// Connect to PeerJS
myPeer = new Peer(undefined, { 
  path: '/peerjs', 
  host: '/', 
  port: location.port || (location.protocol === 'https:' ? 443 : 80),
  config: {
      iceServers: [
          // 1. Google's Free STUN Server (Works for 80% of users)
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },

          // 2. (Optional) Your TURN Server would go here
          // {
          //   urls: "turn:your-turn-server.com:3478",
          //   username: "username",
          //   credential: "password"
          // }
      ]
  }
}); 
  
  myPeer.on('open', id => {
      socket.emit('join_room', { room: currentRoom, peerId: id, username: myUsername }); 
  });

  myPeer.on('call', call => {
    call.answer(myStream);
    const callerName = (call.metadata && call.metadata.username) ? call.metadata.username : "Friend";
    call.on('stream', stream => addVideoToGrid(stream, call.peer, callerName));
  });
  
  myPeer.on('error', err => console.error("PeerJS Error:", err));

  // Switch UI
  lobby.style.display = 'none';
  videoRoom.style.display = 'block';
  document.getElementById('roomDisplay').innerText = `Room: ${currentRoom}`;
  refreshLibrary(); 
});

document.getElementById('leaveBtn').addEventListener('click', () => window.location.reload());

// --- WEBRTC ---
socket.on('user_connected', (data) => setTimeout(() => connectToNewUser(data.peerId, myStream, data.username), 1000));
socket.on('user_disconnected', (userId) => { if (peers[userId]) peers[userId].close(); removeVideo(userId); });

function connectToNewUser(userId, stream, username) {
  const call = myPeer.call(userId, stream, { metadata: { username: myUsername } });
  call.on('stream', userVideoStream => addVideoToGrid(userVideoStream, userId, username));
  call.on('close', () => removeVideo(userId));
  peers[userId] = call;
}

function addVideoToGrid(stream, userId, username) {
  if (document.getElementById('vid-' + userId)) return; 
  
  const wrapper = document.createElement('div'); 
  wrapper.className = 'video-wrapper'; 
  wrapper.id = 'wrap-' + userId;
  
  // FIX: Explicitly visible by default
  wrapper.dataset.hidden = "false"; 

  const video = document.createElement('video'); 
  video.id = 'vid-' + userId; 
  video.srcObject = stream;
  video.addEventListener('loadedmetadata', () => video.play()); 
  video.className = 'user-video';
  if (userId === 'me') { video.classList.add('my-video'); video.muted = true; }
  
  const tag = document.createElement('div'); 
  tag.className = 'name-tag'; 
  tag.innerText = username || "User";

  wrapper.appendChild(video); 
  wrapper.appendChild(tag);
  
  makeInteractable(wrapper, video);
  videoGrid.append(wrapper);
  
  updateLayout();
}

function removeVideo(userId) { 
    const el = document.getElementById('wrap-' + userId); 
    if (el) el.remove(); 
    updateLayout();
}

// --- DRAG & RESIZE ENGINE ---
function makeInteractable(wrapper, videoEl) {
  wrapper.addEventListener('mousedown', () => {
       document.querySelectorAll('.video-wrapper').forEach(w => w.classList.remove('video-selected'));
       wrapper.classList.add('video-selected');
  });

  wrapper.addEventListener('wheel', (e) => {
      if (document.getElementById('videoRoom').classList.contains('meeting-active')) return;
      e.preventDefault();
      let newW = videoEl.offsetWidth + (e.deltaY * -0.5); 
      if (newW > 50 && newW < 600) {
          videoEl.style.width = newW + 'px';
          videoEl.style.height = (newW * 0.56) + 'px';
      }
  });

  let isDragging = false, startX, startY, initialLeft, initialTop, rafId;
  
  const startDrag = (e) => {
      const isMeeting = document.getElementById('videoRoom').classList.contains('meeting-active');
      if (!document.fullscreenElement || isMeeting) return;
      
      isDragging = true;
      wrapper.classList.add('is-dragging');
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX; startY = clientY;
      
      const rect = wrapper.getBoundingClientRect();
      initialLeft = rect.left; initialTop = rect.top;
      
      wrapper.style.position = 'fixed';
      wrapper.style.left = initialLeft + 'px';
      wrapper.style.top = initialTop + 'px';
      wrapper.style.margin = 0;
  };

  const doDrag = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          const clientY = e.touches ? e.touches[0].clientY : e.clientY;
          wrapper.style.left = `${initialLeft + (clientX - startX)}px`;
          wrapper.style.top = `${initialTop + (clientY - startY)}px`;
      });
  };

  const stopDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      wrapper.classList.remove('is-dragging');
      if (rafId) cancelAnimationFrame(rafId);
  };

  wrapper.addEventListener('mousedown', startDrag); window.addEventListener('mousemove', doDrag); window.addEventListener('mouseup', stopDrag);
  wrapper.addEventListener('touchstart', startDrag); window.addEventListener('touchmove', doDrag); window.addEventListener('touchend', stopDrag);
}

// --- SYNC & PLAYER ---
socket.on('ask_time', (requesterId) => socket.emit('sync_time', { time: mainMovie.currentTime, userToSync: requesterId }));
socket.on('get_time', (time) => mainMovie.currentTime = time);
socket.on('notification', (msg) => showToast(msg));

mainMovie.addEventListener('play', () => { if(!isSyncing && currentRoom) socket.emit('play_video', currentRoom); });
mainMovie.addEventListener('pause', () => { if(!isSyncing && currentRoom) socket.emit('pause_video', currentRoom); });
mainMovie.addEventListener('seeked', () => { if(!isSyncing && currentRoom) socket.emit('seek_video', { room: currentRoom, time: mainMovie.currentTime }); });

socket.on('play_video', () => { isSyncing = true; mainMovie.play(); setTimeout(()=>isSyncing=false, 500); });
socket.on('pause_video', () => { isSyncing = true; mainMovie.pause(); setTimeout(()=>isSyncing=false, 500); });
socket.on('seek_video', (t) => { isSyncing = true; mainMovie.currentTime = t; setTimeout(()=>isSyncing=false, 1000); });

socket.on('change_movie', (data) => {
  if (mainMovie.src !== data.url) { 
      mainMovie.src = data.url; 
      mainMovie.play(); 
      showToast(`Now Playing: ${data.title || 'Movie'}`);
  }
});

// --- LAYOUT ENGINE (Fixes Ghost Bugs) ---

function updateLayout() {
  const isFullscreen = !!document.fullscreenElement;
  const isMeeting = document.getElementById('videoRoom').classList.contains('meeting-active');
  const wraps = document.querySelectorAll('.video-wrapper');
  const videos = document.querySelectorAll('.user-video');

  // 1. CLEANUP (Reset styles)
  wraps.forEach(w => { 
      w.style.cssText = ''; 
      w.className = 'video-wrapper'; 
      // Restore hidden state
      if (w.dataset.hidden === "true") {
          w.style.display = "none";
      } else {
          w.style.display = ""; 
      }
  });
  videos.forEach(v => { 
      v.style.width = ''; 
      v.style.height = ''; 
  });

  // 2. APPLY WATCH MODE (Sidebar Logic)
  if (isFullscreen && !isMeeting) {
    let topOffset = 20;
    wraps.forEach(w => { 
      if (w.style.display === "none") return; // Skip hidden
      w.style.position = 'absolute'; 
      w.style.right = '20px'; 
      w.style.top = topOffset + 'px'; 
      w.style.left = 'auto'; 
      w.style.margin = '0';
      topOffset += 120; 
    });
  }
  // If isMeeting is true, we do nothing -> CSS Grid handles it.
}

// 1. Fullscreen Toggle
function togglePartyFullscreen() {
  const elem = document.getElementById('videoRoom');
  if (!document.fullscreenElement) {
    elem.requestFullscreen().catch(err => alert(err.message));
  } else {
    document.exitFullscreen();
  }
}
document.addEventListener('fullscreenchange', updateLayout);

// 2. Meeting Mode
function toggleMeetingMode() {
    const room = document.getElementById('videoRoom');
    const btn = document.getElementById('meetBtn');
    room.classList.toggle('meeting-active');
    
    if (room.classList.contains('meeting-active')) {
        btn.innerText = "🎬 Watch Mode";
        btn.style.color = "#ffd700";
    } else {
        btn.innerText = "👥 Meeting Mode";
        btn.style.color = "";
    }
    updateLayout();
}

// 3. Self View Toggle
function toggleSelfView() {
    const myWrapper = document.getElementById('wrap-me');
    const btn = document.getElementById('selfViewBtn');
    if (!myWrapper) return;

    const isHidden = myWrapper.style.display === 'none' || myWrapper.dataset.hidden === "true";

    if (isHidden) {
        myWrapper.style.display = ''; 
        myWrapper.dataset.hidden = "false"; 
        btn.style.opacity = "1";
    } else {
        myWrapper.style.display = 'none';
        myWrapper.dataset.hidden = "true"; 
        btn.style.opacity = "0.5";
    }
    updateLayout();
}

// --- UTILS ---
function toggleFaces() {
  videoGrid.style.visibility = (videoGrid.style.visibility === 'hidden') ? 'visible' : 'hidden';
}
function toggleChat() {
  chatContainer.style.display = (chatContainer.style.display === 'flex') ? 'none' : 'flex';
}
function showToast(text) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast'; toast.innerText = text;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// --- PRIVACY CONTROLS ---
function toggleMic() {
  if (!myStream) return showToast("No audio");
  const audioTrack = myStream.getAudioTracks()[0];
  if (audioTrack.enabled) {
    audioTrack.enabled = false; 
    document.getElementById('micBtn').classList.add('btn-danger');
    document.getElementById('micBtn').innerText = "🎤 Unmute";
  } else {
    audioTrack.enabled = true; 
    document.getElementById('micBtn').classList.remove('btn-danger');
    document.getElementById('micBtn').innerText = "🎤 Mute";
  }
}

function toggleCam() {
  if (!myStream) return showToast("No video");
  const videoTrack = myStream.getVideoTracks()[0];
  if (videoTrack.enabled) {
    videoTrack.enabled = false; 
    document.getElementById('camBtn').classList.add('btn-danger');
    document.getElementById('camBtn').innerText = "📷 Start";
  } else {
    videoTrack.enabled = true; 
    document.getElementById('camBtn').classList.remove('btn-danger');
    document.getElementById('camBtn').innerText = "📷 Stop";
  }
}

// --- CHAT ---
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', (e) => { if(e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const input = document.getElementById('chatInput');
  if(input.value.trim()) { socket.emit('send_message', input.value.trim()); input.value = ""; }
}
socket.on('receive_message', (data) => {
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.innerHTML += `<div class="message"><span class="msg-user">${data.user}</span>${data.text}</div>`;
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// --- LIBRARY (CLOUD) ---
document.getElementById('uploadBtn').addEventListener('click', async () => {
  const vidInput = document.getElementById('videoInput'); 
  const imgInput = document.getElementById('imageInput'); 
  const btn = document.getElementById('uploadBtn');
  
  if(!vidInput.files[0]) return alert("Select a video file!");
  
  btn.innerText = "Uploading..."; 
  btn.disabled = true;
  
  const formData = new FormData(); 
  formData.append('room', currentRoom); 
  formData.append('videoFile', vidInput.files[0]);
  if(imgInput.files[0]) formData.append('imageFile', imgInput.files[0]); 
  
  try { 
      const res = await fetch('/upload', { method: 'POST', body: formData }); 
      if(res.ok) { 
          showToast("Upload Complete!"); 
          refreshLibrary(); 
      } else { 
          alert("Upload Failed."); 
      } 
  } catch (err) { 
      console.error(err);
      alert("Error uploading file."); 
  }
  
  btn.innerText = "Upload"; 
  btn.disabled = false; 
  vidInput.value = ""; 
  imgInput.value = "";
});

async function refreshLibrary() {
  if(!currentRoom) return;
  const grid = document.getElementById('movieGrid');
  try {
      const res = await fetch(`/files?room=${currentRoom}`); 
      const items = await res.json(); 
      grid.innerHTML = "";
      
      items.forEach(item => {
        const card = document.createElement('div'); 
        card.className = 'movie-card'; 
        card.onclick = () => window.playMovie(item.video, item.title);
        const displayTitle = item.title || "Movie";
        
        card.innerHTML = item.image 
            ? `<img src="${item.image}"><div class="fallback-title" style="display:none;">${displayTitle}</div>` 
            : `<div class="fallback-title">${displayTitle}</div>`;
            
        grid.appendChild(card);
      });
  } catch(e) { console.log("Library Error", e); }
}

window.playMovie = (url, title) => {
    socket.emit('change_movie', { room: currentRoom, url: url, title: title });
};