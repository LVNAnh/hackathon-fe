class VideoCallApp {
  constructor() {
    this.socket = io("http://localhost:4000", {
      transports: ["websocket", "polling"],
    });
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
    // Khi có user mới tham gia, tạo offer cho họ
    this.socket.on("user-joined", async (user) => {
      console.log("New user joined:", user);
      if (this.localStream) {
        await this.createOfferForUser(user.id);
      }
    });

    // Khi join room, nhận danh sách user đã có và tạo offer cho tất cả
    this.socket.on("existing-users", async (users) => {
      console.log("Existing users:", users);
      for (const user of users) {
        if (this.localStream) {
          await this.createOfferForUser(user.id);
        }
      }
    });

    this.socket.on("user-left", (userId) => {
      console.log("User left:", userId);
      this.removeRemoteVideo(userId);
      if (this.peerConnections.has(userId)) {
        this.peerConnections.get(userId).close();
        this.peerConnections.delete(userId);
      }
    });

    this.socket.on("offer", async (data) => {
      console.log("Received offer from:", data.caller);
      await this.handleOffer(data);
    });

    this.socket.on("answer", async (data) => {
      console.log("Received answer from:", data.answerer);
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
      const response = await fetch("http://localhost:4000/api/create-room", {
        method: "POST",
      });
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
      const response = await fetch(`http://localhost:4000/api/room/${roomId}`);
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
        video: { width: 1280, height: 720 },
        audio: true,
      });

      this.localVideo.srcObject = this.localStream;

      // Join room sau khi có stream
      this.socket.emit("join-room", {
        roomId: this.currentRoomId,
        userName: this.userName,
      });

      this.showCallScreen();
    } catch (error) {
      console.error("Error accessing media devices:", error);
      alert("Không thể truy cập camera/microphone. Vui lòng cấp quyền.");
    }
  }

  async createPeerConnection(userId) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log("Received remote stream from:", userId);
      const [remoteStream] = event.streams;
      this.addRemoteVideo(userId, remoteStream);
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

    // Connection state logging
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${userId}:`, pc.connectionState);
    };

    this.peerConnections.set(userId, pc);
    return pc;
  }

  async createOfferForUser(userId) {
    try {
      const pc = await this.createPeerConnection(userId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.socket.emit("offer", {
        target: userId,
        offer: offer,
      });

      console.log("Sent offer to:", userId);
    } catch (error) {
      console.error("Error creating offer for user:", userId, error);
    }
  }

  async handleOffer(data) {
    try {
      const pc = await this.createPeerConnection(data.caller);
      await pc.setRemoteDescription(data.offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.emit("answer", {
        target: data.caller,
        answer: answer,
      });

      console.log("Sent answer to:", data.caller);
    } catch (error) {
      console.error("Error handling offer:", error);
    }
  }

  async handleAnswer(data) {
    try {
      const pc = this.peerConnections.get(data.answerer);
      if (pc && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(data.answer);
        console.log("Set remote description for:", data.answerer);
      }
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  }

  async handleIceCandidate(data) {
    try {
      const pc = this.peerConnections.get(data.sender);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (error) {
      console.error("Error handling ICE candidate:", error);
    }
  }

  addRemoteVideo(userId, stream) {
    // Remove existing video if any
    this.removeRemoteVideo(userId);

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

    console.log("Added remote video for:", userId);
  }

  removeRemoteVideo(userId) {
    const videoElement = document.getElementById(`remote-${userId}`);
    if (videoElement) {
      videoElement.remove();
      console.log("Removed remote video for:", userId);
    }
  }

  toggleVideo() {
    this.isVideoEnabled = !this.isVideoEnabled;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = this.isVideoEnabled;
      });
    }
    this.toggleVideoBtn.classList.toggle("active", this.isVideoEnabled);
    this.toggleVideoBtn.textContent = this.isVideoEnabled ? "📹" : "📹❌";
  }

  toggleAudio() {
    this.isAudioEnabled = !this.isAudioEnabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = this.isAudioEnabled;
      });
    }
    this.toggleAudioBtn.classList.toggle("active", this.isAudioEnabled);
    this.toggleAudioBtn.textContent = this.isAudioEnabled ? "🎤" : "🎤❌";
  }

  endCall() {
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Close all peer connections
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    // Clear remote videos
    this.remoteVideos.innerHTML = "";

    // Reset button states
    this.isVideoEnabled = true;
    this.isAudioEnabled = true;
    this.toggleVideoBtn.classList.add("active");
    this.toggleAudioBtn.classList.add("active");
    this.toggleVideoBtn.textContent = "📹";
    this.toggleAudioBtn.textContent = "🎤";

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
