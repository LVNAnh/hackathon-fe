class VideoCallApp {
  constructor() {
    this.socket = io("http://192.168.20.70:4000");
    this.localStream = null;
    this.peerConnections = new Map();
    this.currentRoomId = null;
    this.userName = null;
    this.isVideoEnabled = true;
    this.isAudioEnabled = true;

    this.initializeElements();
    this.setupEventListeners();
    this.setupSocketListeners();
  }

  initializeElements() {
    // Screens
    this.homeScreen = document.getElementById("home-screen");
    this.waitingScreen = document.getElementById("waiting-screen");
    this.callScreen = document.getElementById("call-screen");

    // Buttons
    this.createRoomBtn = document.getElementById("create-room-btn");
    this.joinRoomBtn = document.getElementById("join-room-btn");
    this.startCallBtn = document.getElementById("start-call-btn");
    this.backBtn = document.getElementById("back-btn");
    this.endCallBtn = document.getElementById("end-call-btn");
    this.toggleVideoBtn = document.getElementById("toggle-video-btn");
    this.toggleAudioBtn = document.getElementById("toggle-audio-btn");

    // Inputs
    this.roomIdInput = document.getElementById("room-id-input");
    this.userNameInput = document.getElementById("user-name-input");

    // Video elements
    this.localVideo = document.getElementById("local-video");
    this.remoteVideos = document.getElementById("remote-videos");

    // Info elements
    this.currentRoomIdSpan = document.getElementById("current-room-id");
    this.callRoomIdSpan = document.getElementById("call-room-id");
  }

  setupEventListeners() {
    this.createRoomBtn.addEventListener("click", () => this.createRoom());
    this.joinRoomBtn.addEventListener("click", () => this.joinRoom());
    this.startCallBtn.addEventListener("click", () => this.startCall());
    this.backBtn.addEventListener("click", () => this.goHome());
    this.endCallBtn.addEventListener("click", () => this.endCall());
    this.toggleVideoBtn.addEventListener("click", () => this.toggleVideo());
    this.toggleAudioBtn.addEventListener("click", () => this.toggleAudio());

    this.roomIdInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.joinRoom();
    });

    this.userNameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.startCall();
    });
  }

  setupSocketListeners() {
    this.socket.on("users-in-room", (users) => {
      console.log("Users in room:", users);
    });

    this.socket.on("user-joined", (user) => {
      console.log("User joined:", user);
    });

    this.socket.on("user-left", (userId) => {
      this.removeRemoteVideo(userId);
      if (this.peerConnections.has(userId)) {
        this.peerConnections.get(userId).close();
        this.peerConnections.delete(userId);
      }
    });

    this.socket.on("offer", async (data) => {
      await this.handleOffer(data);
    });

    this.socket.on("answer", async (data) => {
      await this.handleAnswer(data);
    });

    this.socket.on("ice-candidate", async (data) => {
      await this.handleIceCandidate(data);
    });

    this.socket.on("error", (message) => {
      alert("Lỗi: " + message);
    });
  }

  async createRoom() {
    try {
      const response = await fetch(
        "http://192.168.20.70:4000/api/create-room",
        {
          method: "POST",
        }
      );
      const data = await response.json();
      this.currentRoomId = data.roomId;
      this.showWaitingScreen();
    } catch (error) {
      alert("Không thể tạo phòng. Vui lòng thử lại.");
    }
  }

  async joinRoom() {
    const roomId = this.roomIdInput.value.trim().toUpperCase();
    if (!roomId) {
      alert("Vui lòng nhập mã phòng");
      return;
    }

    try {
      const response = await fetch(
        `http://192.168.20.70:4000/api/room/${roomId}`
      );
      const data = await response.json();

      if (data.exists) {
        this.currentRoomId = roomId;
        this.showWaitingScreen();
      } else {
        alert("Phòng không tồn tại");
      }
    } catch (error) {
      alert("Không thể kiểm tra phòng. Vui lòng thử lại.");
    }
  }

  async startCall() {
    this.userName = this.userNameInput.value.trim() || `User${Date.now()}`;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      this.localVideo.srcObject = this.localStream;
      this.socket.emit("join-room", {
        roomId: this.currentRoomId,
        userName: this.userName,
      });

      this.showCallScreen();
    } catch (error) {
      alert("Không thể truy cập camera/microphone. Vui lòng cấp quyền.");
    }
  }

  async createPeerConnection(userId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // Add local stream
    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });

    // Handle remote stream
    pc.ontrack = (event) => {
      this.addRemoteVideo(userId, event.streams[0]);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("ice-candidate", {
          target: userId,
          candidate: event.candidate,
        });
      }
    };

    this.peerConnections.set(userId, pc);
    return pc;
  }

  async handleOffer(data) {
    const pc = await this.createPeerConnection(data.caller);
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.socket.emit("answer", {
      target: data.caller,
      answer: answer,
    });
  }

  async handleAnswer(data) {
    const pc = this.peerConnections.get(data.answerer);
    if (pc) {
      await pc.setRemoteDescription(data.answer);
    }
  }

  async handleIceCandidate(data) {
    const pc = this.peerConnections.get(data.sender);
    if (pc) {
      await pc.addIceCandidate(data.candidate);
    }
  }

  addRemoteVideo(userId, stream) {
    const videoContainer = document.createElement("div");
    videoContainer.className = "video-container";
    videoContainer.id = `remote-${userId}`;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = stream;

    const label = document.createElement("div");
    label.className = "video-label";
    label.textContent = `User ${userId.substring(0, 6)}`;

    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    this.remoteVideos.appendChild(videoContainer);
  }

  removeRemoteVideo(userId) {
    const videoElement = document.getElementById(`remote-${userId}`);
    if (videoElement) {
      videoElement.remove();
    }
  }

  toggleVideo() {
    this.isVideoEnabled = !this.isVideoEnabled;
    this.localStream.getVideoTracks().forEach((track) => {
      track.enabled = this.isVideoEnabled;
    });
    this.toggleVideoBtn.classList.toggle("active", this.isVideoEnabled);
  }

  toggleAudio() {
    this.isAudioEnabled = !this.isAudioEnabled;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = this.isAudioEnabled;
    });
    this.toggleAudioBtn.classList.toggle("active", this.isAudioEnabled);
  }

  endCall() {
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
    }

    // Close all peer connections
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    // Clear remote videos
    this.remoteVideos.innerHTML = "";

    // Disconnect from room
    this.socket.disconnect();
    this.socket.connect();

    this.goHome();
  }

  showWaitingScreen() {
    this.homeScreen.classList.remove("active");
    this.waitingScreen.classList.add("active");
    this.callScreen.classList.remove("active");
    this.currentRoomIdSpan.textContent = this.currentRoomId;
  }

  showCallScreen() {
    this.homeScreen.classList.remove("active");
    this.waitingScreen.classList.remove("active");
    this.callScreen.classList.add("active");
    this.callRoomIdSpan.textContent = this.currentRoomId;
  }

  goHome() {
    this.homeScreen.classList.add("active");
    this.waitingScreen.classList.remove("active");
    this.callScreen.classList.remove("active");
    this.roomIdInput.value = "";
    this.userNameInput.value = "";
    this.currentRoomId = null;
  }
}

// Initialize app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new VideoCallApp();
});
