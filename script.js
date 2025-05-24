class VideoCallApp {
  constructor() {
    this.socket = io("https://hackathon-be-xaqp.onrender.com", {
      transports: ["websocket", "polling"],
    });
    this.localStream = null;
    this.peerConnections = new Map();
    this.iceCandidatesQueue = new Map(); // Queue for ICE candidates
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
    // Khi có user mới tham gia - chỉ user đã có trước đó sẽ tạo offer
    this.socket.on("user-joined", async (user) => {
      console.log("New user joined:", user);
      if (this.localStream) {
        // Tạo offer cho user mới
        await this.initiateCall(user.id);
      }
    });

    // Khi nhận offer từ user khác
    this.socket.on("offer", async (data) => {
      console.log("Received offer from:", data.caller);
      await this.handleIncomingCall(data.caller, data.offer);
    });

    // Khi nhận answer
    this.socket.on("answer", async (data) => {
      console.log("Received answer from:", data.answerer);
      await this.handleCallAnswer(data.answerer, data.answer);
    });

    // Khi nhận ICE candidate
    this.socket.on("ice-candidate", async (data) => {
      console.log("Received ICE candidate from:", data.sender);
      await this.handleNewICECandidate(data.sender, data.candidate);
    });

    this.socket.on("user-left", (userId) => {
      console.log("User left:", userId);
      this.cleanupPeerConnection(userId);
    });

    this.socket.on("error", (message) => {
      console.error("Socket error:", message);
      alert("Lỗi: " + message);
    });
  }

  async createRoom() {
    try {
      const response = await fetch(
        "https://hackathon-be-xaqp.onrender.com/api/create-room",
        {
          method: "POST",
        }
      );
      const data = await response.json();
      this.currentRoomId = data.roomId;
      this.showWaitingScreen();
    } catch (error) {
      console.error("Error creating room:", error);
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
        `https://hackathon-be-xaqp.onrender.com/api/room/${roomId}`
      );
      const data = await response.json();

      if (data.exists) {
        this.currentRoomId = roomId;
        this.showWaitingScreen();
      } else {
        alert("Phòng không tồn tại");
      }
    } catch (error) {
      console.error("Error checking room:", error);
      alert("Không thể kiểm tra phòng. Vui lòng thử lại.");
    }
  }

  async startCall() {
    this.userName = this.userNameInput.value.trim() || `User${Date.now()}`;

    try {
      console.log("Getting user media...");
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log(
        "Got local stream with tracks:",
        this.localStream.getTracks().map((t) => t.kind)
      );
      this.localVideo.srcObject = this.localStream;

      // Join room sau khi có stream
      this.socket.emit("join-room", {
        roomId: this.currentRoomId,
        userName: this.userName,
      });

      this.showCallScreen();
    } catch (error) {
      console.error("Error accessing media devices:", error);
      alert(
        "Không thể truy cập camera/microphone. Vui lòng cấp quyền và thử lại."
      );
    }
  }

  // Tạo peer connection mới
  createPeerConnection(userId) {
    console.log("Creating peer connection for:", userId);

    const configuration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
    };

    const peerConnection = new RTCPeerConnection(configuration);

    // Thêm local tracks vào peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        console.log(
          `Adding ${track.kind} track to peer connection for ${userId}`
        );
        peerConnection.addTrack(track, this.localStream);
      });
    }

    // Xử lý remote stream
    peerConnection.ontrack = (event) => {
      console.log(`Received ${event.track.kind} track from ${userId}`);
      const [remoteStream] = event.streams;
      this.displayRemoteStream(userId, remoteStream);
    };

    // Xử lý ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate to:", userId);
        this.socket.emit("ice-candidate", {
          target: userId,
          candidate: event.candidate,
        });
      }
    };

    // Monitor connection state
    peerConnection.onconnectionstatechange = () => {
      console.log(
        `Connection state with ${userId}:`,
        peerConnection.connectionState
      );
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(
        `ICE connection state with ${userId}:`,
        peerConnection.iceConnectionState
      );
    };

    this.peerConnections.set(userId, peerConnection);
    return peerConnection;
  }

  // Khởi tạo cuộc gọi (tạo offer)
  async initiateCall(userId) {
    try {
      console.log("Initiating call to:", userId);

      const peerConnection = this.createPeerConnection(userId);

      const offer = await peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true,
      });

      await peerConnection.setLocalDescription(offer);

      console.log("Sending offer to:", userId);
      this.socket.emit("offer", {
        target: userId,
        offer: offer,
      });
    } catch (error) {
      console.error("Error initiating call:", error);
    }
  }

  // Xử lý cuộc gọi đến (nhận offer)
  async handleIncomingCall(callerId, offer) {
    try {
      console.log("Handling incoming call from:", callerId);

      const peerConnection = this.createPeerConnection(callerId);

      await peerConnection.setRemoteDescription(offer);

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      console.log("Sending answer to:", callerId);
      this.socket.emit("answer", {
        target: callerId,
        answer: answer,
      });

      // Process queued ICE candidates
      if (this.iceCandidatesQueue.has(callerId)) {
        const queuedCandidates = this.iceCandidatesQueue.get(callerId);
        for (const candidate of queuedCandidates) {
          try {
            await peerConnection.addIceCandidate(candidate);
            console.log("Added queued ICE candidate from:", callerId);
          } catch (error) {
            console.error("Error adding queued ICE candidate:", error);
          }
        }
        this.iceCandidatesQueue.delete(callerId);
      }
    } catch (error) {
      console.error("Error handling incoming call:", error);
    }
  }

  // Xử lý answer
  async handleCallAnswer(userId, answer) {
    try {
      console.log("Handling call answer from:", userId);

      const peerConnection = this.peerConnections.get(userId);
      if (!peerConnection) {
        console.error("No peer connection found for:", userId);
        return;
      }

      await peerConnection.setRemoteDescription(answer);
      console.log("Set remote description for:", userId);

      // Process queued ICE candidates
      if (this.iceCandidatesQueue.has(userId)) {
        const queuedCandidates = this.iceCandidatesQueue.get(userId);
        for (const candidate of queuedCandidates) {
          try {
            await peerConnection.addIceCandidate(candidate);
            console.log("Added queued ICE candidate from:", userId);
          } catch (error) {
            console.error("Error adding queued ICE candidate:", error);
          }
        }
        this.iceCandidatesQueue.delete(userId);
      }
    } catch (error) {
      console.error("Error handling call answer:", error);
    }
  }

  // Xử lý ICE candidate
  async handleNewICECandidate(userId, candidate) {
    try {
      const peerConnection = this.peerConnections.get(userId);

      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(candidate);
        console.log("Added ICE candidate from:", userId);
      } else {
        console.log("Queuing ICE candidate from:", userId);
        // Queue the candidate
        if (!this.iceCandidatesQueue.has(userId)) {
          this.iceCandidatesQueue.set(userId, []);
        }
        this.iceCandidatesQueue.get(userId).push(candidate);
      }
    } catch (error) {
      console.error("Error handling ICE candidate:", error);
    }
  }

  // Hiển thị remote stream
  displayRemoteStream(userId, stream) {
    console.log("Displaying remote stream for:", userId);

    // Remove existing video nếu có
    this.removeRemoteVideo(userId);

    const videoContainer = document.createElement("div");
    videoContainer.className = "video-container";
    videoContainer.id = `remote-${userId}`;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsinline = true;
    video.muted = false;
    video.controls = false;

    // Set stream
    video.srcObject = stream;

    // Add event listeners
    video.onloadedmetadata = () => {
      console.log("Remote video metadata loaded for:", userId);
      video.play().catch(console.error);
    };

    video.onplay = () => {
      console.log("Remote video started playing for:", userId);
    };

    video.onerror = (error) => {
      console.error("Remote video error for:", userId, error);
    };

    const label = document.createElement("div");
    label.className = "video-label";
    label.textContent = `User ${userId.substring(0, 6)}`;

    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    this.remoteVideos.appendChild(videoContainer);

    console.log("Remote video added for:", userId);

    // Force play after a short delay
    setTimeout(() => {
      video.play().catch(console.error);
    }, 100);
  }

  removeRemoteVideo(userId) {
    const videoElement = document.getElementById(`remote-${userId}`);
    if (videoElement) {
      videoElement.remove();
      console.log("Removed remote video for:", userId);
    }
  }

  cleanupPeerConnection(userId) {
    if (this.peerConnections.has(userId)) {
      const peerConnection = this.peerConnections.get(userId);
      peerConnection.close();
      this.peerConnections.delete(userId);
    }

    if (this.iceCandidatesQueue.has(userId)) {
      this.iceCandidatesQueue.delete(userId);
    }

    this.removeRemoteVideo(userId);
    console.log("Cleaned up peer connection for:", userId);
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
    console.log("Ending call...");

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.stop();
        console.log(`Stopped ${track.kind} track`);
      });
      this.localStream = null;
    }

    // Close all peer connections
    this.peerConnections.forEach((pc, userId) => {
      console.log("Closing peer connection for:", userId);
      pc.close();
    });
    this.peerConnections.clear();
    this.iceCandidatesQueue.clear();

    // Clear remote videos
    this.remoteVideos.innerHTML = "";

    // Reset button states
    this.isVideoEnabled = true;
    this.isAudioEnabled = true;
    this.toggleVideoBtn.classList.add("active");
    this.toggleAudioBtn.classList.add("active");
    this.toggleVideoBtn.textContent = "📹";
    this.toggleAudioBtn.textContent = "🎤";

    // Leave room
    if (this.currentRoomId) {
      this.socket.emit("leave-room", this.currentRoomId);
    }

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
