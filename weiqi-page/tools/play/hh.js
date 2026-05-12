const SIGNAL_URL = 'wss://api.weiqi.lol/ws/signal';
const BOARD_SIZE = 19;
const STONE_RADIUS_RATIO = 0.42;

let ws = null, pc = null, dataChannel = null;
let selectedPosition = null;  // 用户选中的位置（两步落子）
let heartbeatInterval = null;  // 心跳定时器
let missedHeartbeats = 0;  // 未收到的心跳计数
let aiEngine = null;  // AI 引擎实例
let aiInitialized = false;  // AI 是否已初始化
let gameState = {
    room: null, myName: '', myColor: null, opponentName: '',
    handicap: 0, timeLimit: 30, isCreator: false,
    board: [], currentPlayer: 'black', moveHistory: [],
    blackTime: 0, whiteTime: 0, timerInterval: null,
    lastMoveTimestamp: null,  // 最后落子时间戳，用于断线重连后计算消耗的时间
    lastMoveWasPass: false, gameEnded: false, inGame: false, isReconnect: false,
    reconnectTimeout: null, reconnectCountdownTimer: null, reconnectCountdown: 0,
    countRequested: false, countRequestedBy: null, myCountResult: null, opponentCountResult: null
};

function generateRandomName() {
    const p = ['天','地','风','云','雷','电','山','水','星','月','龙','虎','鹰','狼','狐','熊','鹏','麟','鹤','雀','青','白','红','金','银','玄','紫','蓝','翠','墨','松','竹','梅','兰','菊','莲','枫','柳','桐','梧'];
    const s = ['弈','棋','客','士','仙','圣','王','君','子','灵','影','魂','心','剑','刃','峰','谷','渊','岳','涛','澜','轩','阁','斋','堂','居','舍','苑','楼','境','界','域','庭','院','台','榭'];
    return p[Math.floor(Math.random() * p.length)] + s[Math.floor(Math.random() * s.length)];
}

function generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function formatTime(sec) {
    return Math.floor(sec/60) + ':' + (sec%60).toString().padStart(2,'0');
}

function showToast(msg) { document.getElementById('gameStatus').textContent = msg; }

function showCreateDialog() {
    const n = localStorage.getItem('weiqi-player-name') || generateRandomName();
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay" onclick="event.target===this&&showStartDialog()"><div class="dialog">'+
    '<div class="dialog-title">创建房间</div>'+
    '<div class="form-group"><label>你的名称</label><div class="form-row">'+
    '<input type="text" id="createName" value="'+n+'">'+
    '<button class="btn-small" onclick="document.getElementById(\'createName\').value=generateRandomName()">随机</button>'+
    '</div></div>'+
    '<div class="form-group"><label>执棋</label><div class="radio-group">'+
    '<input type="radio" name="color" id="cB" value="black" checked><label for="cB">执黑</label>'+
    '<input type="radio" name="color" id="cW" value="white"><label for="cW">执白</label>'+
    '<input type="radio" name="color" id="cR" value="random"><label for="cR">猜先</label>'+
    '</div></div>'+
    '<div class="form-group"><label>让子</label><select id="handicap">'+
    '<option value="0">不让子</option><option value="2">2 子</option><option value="3">3 子</option>'+
    '<option value="4">4 子</option><option value="5">5 子</option><option value="6">6 子</option>'+
    '<option value="7">7 子</option><option value="8">8 子</option><option value="9">9 子</option></select></div>'+
    '<div class="form-group"><label>每方用时</label><select id="timeLimit">'+
    '<option value="5">5 分钟</option><option value="10">10 分钟</option>'+
    '<option value="30" selected>30 分钟</option><option value="60">60 分钟</option></select></div>'+
    '<button class="btn btn-primary" onclick="createRoom()">创建</button>'+
    '<button class="btn btn-secondary" onclick="showStartDialog()">取消</button></div></div>';
}

function showJoinDialog() {
    const n = localStorage.getItem('weiqi-player-name') || generateRandomName();
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay" onclick="event.target===this&&showStartDialog()"><div class="dialog">'+
    '<div class="dialog-title">加入房间</div>'+
    '<div class="form-group"><label>房间ID</label>'+
    '<input type="text" id="joinRoomId" placeholder="输入6位房间ID" style="text-transform:uppercase"></div>'+
    '<div class="form-group"><label>你的名称</label><div class="form-row">'+
    '<input type="text" id="joinName" value="'+n+'">'+
    '<button class="btn-small" onclick="document.getElementById(\'joinName\').value=generateRandomName()">随机</button>'+
    '</div></div>'+
    '<button class="btn btn-primary" onclick="joinRoom()">加入</button>'+
    '<button class="btn btn-secondary" onclick="showStartDialog()">取消</button></div></div>';
}

function closeDialog() { document.getElementById('dialogContainer').innerHTML = ''; }

function createRoom() {
    const name = document.getElementById('createName').value.trim() || generateRandomName();
    const color = document.querySelector('input[name="color"]:checked').value;
    gameState.room = generateRoomId();
    gameState.myName = name;
    gameState.myColor = color === 'random' ? (Math.random()>0.5?'black':'white') : color;
    gameState.handicap = parseInt(document.getElementById('handicap').value);
    gameState.timeLimit = parseInt(document.getElementById('timeLimit').value);
    gameState.isCreator = true;  // 标记为创建方
    localStorage.setItem('weiqi-player-name', name);
    closeDialog();
    showWaitingDialog();
    connectWebSocket(gameState.room, true);
}

function joinRoom() {
    const roomId = document.getElementById('joinRoomId').value.trim().toUpperCase();
    const name = document.getElementById('joinName').value.trim() || generateRandomName();
    if (!roomId || roomId.length !== 6) { alert('请输入6位房间ID'); return; }
    gameState.room = roomId;
    gameState.myName = name;
    gameState.isCreator = false;  // 标记为加入方
    localStorage.setItem('weiqi-player-name', name);
    closeDialog();
    showToast('连接中...');
    connectWebSocket(roomId, false);
}

function showWaitingDialog() {
    const ht = gameState.handicap===0 ? '不让子' : '让 '+gameState.handicap+' 子';
    const myColorText = gameState.myColor==='black' ? '你执黑' : '你执白';
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog">'+
    '<div class="dialog-title">等待对手加入</div>'+
    '<div class="room-display"><div class="label">房间ID</div><div class="value">'+gameState.room+'</div></div>'+
    '<div style="text-align:center;margin-bottom:12px">'+
    '<button class="btn-small" id="copyBtn" onclick="copyRoomId()">复制房间ID</button></div>'+
    '<div style="margin-bottom:12px"><div style="font-size:13px;color:#666;margin-bottom:8px">对局条件</div>'+
    '<ul class="condition-list"><li>'+myColorText+'</li>'+
    '<li>'+ht+'</li><li>每方 '+gameState.timeLimit+' 分钟</li></ul></div>'+
    '<div class="waiting"><span class="waiting-dots">等待对手</span></div>'+
    '<button class="btn btn-secondary" onclick="cancelRoom()">取消</button></div></div>';
}

function copyRoomId() {
    navigator.clipboard.writeText(gameState.room).then(() => {
        const btn = document.getElementById('copyBtn');
        if (btn) {
            btn.textContent = '已复制';
            setTimeout(() => { btn.textContent = '复制房间ID'; }, 2000);
        }
    });
}

function showConfirmDialog(on, oc, h, t) {
    const mc = oc==='black'?'white':'black';
    const dn = localStorage.getItem('weiqi-player-name') || generateRandomName();
    const ht = h===0?'不让子':'让 '+h+' 子';
    gameState.opponentName = on; gameState.myColor = mc; gameState.handicap = h; gameState.timeLimit = t;
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog">'+
    '<div class="dialog-title">加入确认</div>'+
    '<div style="margin-bottom:12px"><div style="font-size:13px;color:#666">对手</div>'+
    '<div style="font-size:16px;font-weight:500">'+on+'</div></div>'+
    '<div class="form-group"><label>你的名称</label><div class="form-row">'+
    '<input type="text" id="confirmName" value="'+dn+'">'+
    '<button class="btn-small" onclick="document.getElementById(\'confirmName\').value=generateRandomName()">随机</button>'+
    '</div></div>'+
    '<div style="margin-bottom:12px"><div style="font-size:13px;color:#666;margin-bottom:8px">对局条件</div>'+
    '<ul class="condition-list"><li>你 执'+(mc==='black'?'黑':'白')+'</li><li>'+ht+'</li><li>每方 '+t+' 分钟</li></ul></div>'+
    '<button class="btn btn-primary" onclick="confirmJoin()">确认加入</button>'+
    '<button class="btn btn-secondary" onclick="cancelJoin()">取消</button></div></div>';
}

function cancelRoom() { disconnect(); closeDialog(); showStartDialog(); }
function cancelJoin() { disconnect(); closeDialog(); showStartDialog(); }
function confirmJoin() {
    gameState.myName = document.getElementById('confirmName').value.trim() || generateRandomName();
    localStorage.setItem('weiqi-player-name', gameState.myName);
    sendSignal({ type: 'join-confirm', name: gameState.myName });
    // 显示建立连接状态
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog" style="text-align:center">'+
    '<div style="padding:20px;font-size:15px;color:#666">正在建立连接...</div>'+
    '</div></div>';
}

function startHeartbeat() {
    // 清除旧的心跳
    stopHeartbeat();
    missedHeartbeats = 0;
    
    // 每5秒发送一次心跳
    heartbeatInterval = setInterval(() => {
        // WebSocket 心跳（检测连接状态）
        if (ws && ws.readyState === WebSocket.OPEN) {
            missedHeartbeats++;
            if (missedHeartbeats > 3) {
                // 连续3次没收到回复，认为连接断开
                console.log('Heartbeat timeout');
                stopHeartbeat();
                ws.close();
                return;
            }
            ws.send(JSON.stringify({ type: 'ping' }));
        }
        
        // P2P 心跳（检测状态同步）
        if (dataChannel && dataChannel.readyState === 'open' && gameState.inGame) {
            const version = gameState.moveHistory ? gameState.moveHistory.length : 0;
            console.log('Sending P2P heartbeat, version:', version);
            sendGameMessage({ type: 'heartbeat', version: version });
        } else {
            console.log('P2P heartbeat not sent - dataChannel:', dataChannel ? dataChannel.readyState : 'null', 'inGame:', gameState.inGame);
        }
    }, 5000);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

function connectWebSocket(rid, isCreator) {
    ws = new WebSocket(SIGNAL_URL+'?room='+rid);
    ws.onopen = () => { 
        console.log('WS open'); 
        // 启动心跳，每30秒发送一次
        startHeartbeat();
    };
    ws.onmessage = async (e) => {
        const d = JSON.parse(e.data);
        console.log('Signal:', d);
        
        // 处理心跳响应
        if (d.type === 'pong') {
            missedHeartbeats = 0;
            return;
        }
        
        switch(d.type) {
            case 'connected':
                // 重连时，如果只有自己，说明对手已离开
                if (gameState.isReconnect && d.clients === 1) {
                    showWaitingReconnectDialog(30);
                    gameState.reconnectTimeout = setTimeout(() => {
                        localStorage.removeItem('hh-game-state');
                        endGame('对手已离开，对局结束');
                    }, 30000); // 30秒等待
                }
                break;
            case 'ready':
                // 清除重连超时和倒计时
                const wasWaiting = gameState.reconnectTimeout !== null;
                if (gameState.reconnectTimeout) {
                    clearTimeout(gameState.reconnectTimeout);
                    gameState.reconnectTimeout = null;
                }
                if (gameState.reconnectCountdownTimer) {
                    clearInterval(gameState.reconnectCountdownTimer);
                    gameState.reconnectCountdownTimer = null;
                }
                if (wasWaiting) {
                    closeDialog();
                    showToast('对手已恢复');
                }
                if (gameState.isReconnect) {
                    gameState.isReconnect = false;  // 重连成功
                }
                // 创建方发送房间信息，等对手确认后再创建 offer
                if (gameState.isCreator) {
                    sendSignal({ type:'room-info', name:gameState.myName, color:gameState.myColor, handicap:gameState.handicap, timeLimit:gameState.timeLimit });
                    showToast('对手已加入，等待确认...');
                }
                if (!wasWaiting && !gameState.isReconnect && !gameState.isCreator) showToast('对手已加入');
                break;
            case 'room-info': 
                if (gameState.inGame) {
                    // 对手重连，不显示确认弹框，直接发送 join-confirm 建立连接
                    sendSignal({ type: 'join-confirm', name: gameState.myName });
                } else {
                    showConfirmDialog(d.name, d.color, d.handicap, d.timeLimit);
                }
                break;
            case 'join-confirm': 
                gameState.opponentName = d.name; 
                // 创建方收到确认后才创建 offer
                if (gameState.isCreator) {
                    showToast('对手已确认，建立连接...');
                    await createOffer();
                }
                // 更新名称显示
                if (gameState.myColor==='black') {
                    document.getElementById('whiteName').textContent = d.name || '白方';
                } else {
                    document.getElementById('blackName').textContent = d.name || '黑方';
                }
                break;
            case 'offer': await handleOffer(d.data); break;
            case 'answer': await handleAnswer(d.data); break;
            case 'ice': await handleIce(d.data); break;
            case 'disconnected': 
                if (gameState.inGame && !gameState.gameEnded && !gameState.isReconnect) {
                    // 先显示简单提示，等待5秒后才弹框
                    showToast('对手连接中断，等待恢复...');
                    gameState.reconnectTimeout = setTimeout(() => {
                        if (!gameState.gameEnded && gameState.inGame) {
                            showWaitingReconnectDialog(60);
                            gameState.reconnectTimeout = setTimeout(() => {
                                if (!gameState.gameEnded) {
                                    endGame('对手超时未恢复');
                                }
                            }, 60000); // 60秒超时
                        }
                    }, 5000); // 5秒后才弹框
                }
                break;
        }
    };
    ws.onerror = (e) => { 
        console.error('WS error:', e); 
        if (gameState.isReconnect) {
            localStorage.removeItem('hh-game-state');
            closeDialog();
            showToast('���法重新连接，对局已结束');
            showStartDialog();
        } else {
            showToast('连接错误');
        }
    };
    ws.onclose = () => { 
        console.log('WS close'); 
        stopHeartbeat();
        if (gameState.reconnectTimeout) {
            clearTimeout(gameState.reconnectTimeout);
            gameState.reconnectTimeout = null;
        }
        if (gameState.reconnectCountdownTimer) {
            clearInterval(gameState.reconnectCountdownTimer);
            gameState.reconnectCountdownTimer = null;
        }
    };
}

function sendSignal(d) { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(d)); }

function createPeerConnection() {
    pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}] });
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ type:'ice', data:e.candidate }); };
    pc.ondatachannel = (e) => { 
        console.log('Received datachannel');
        dataChannel = e.channel; 
        setupDataChannel(); 
    };
    pc.onconnectionstatechange = () => {
        console.log('P2P connection state:', pc.connectionState);
        if (pc.connectionState==='connected') startGame();
        else if (pc.connectionState==='disconnected'||pc.connectionState==='failed') showToast('P2P 断开');
    };
}

function setupDataChannel() {
    dataChannel.onopen = () => { console.log('DataChannel open'); startGame(); };
    dataChannel.onclose = () => { console.log('DataChannel closed'); };
    dataChannel.onerror = (e) => { console.error('DataChannel error:', e); };
    dataChannel.onmessage = (e) => { handleGameMessage(JSON.parse(e.data)); };
}

async function createOffer() {
    console.log('Creating WebRTC offer...');
    createPeerConnection();
    dataChannel = pc.createDataChannel('game');
    console.log('DataChannel created, state:', dataChannel.readyState);
    setupDataChannel();
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    sendSignal({ type:'offer', data:o });
    console.log('Offer sent');
}

async function handleOffer(o) {
    createPeerConnection();
    await pc.setRemoteDescription(o);
    const a = await pc.createAnswer();
    await pc.setLocalDescription(a);
    sendSignal({ type:'answer', data:a });
}

async function handleAnswer(a) { await pc.setRemoteDescription(a); }
async function handleIce(c) { await pc.addIceCandidate(c); }

function sendGameMessage(d) { if (dataChannel && dataChannel.readyState==='open') dataChannel.send(JSON.stringify(d)); }

function sendStateSync() {
    // 发送完整状态给对手，用于断线重连后的状态同步
    sendGameMessage({
        type: 'state-sync',
        name: gameState.myName,
        color: gameState.myColor,
        opponentName: gameState.opponentName,
        handicap: gameState.handicap,
        timeLimit: gameState.timeLimit,
        board: gameState.board,
        moveHistory: gameState.moveHistory,
        currentPlayer: gameState.currentPlayer,
        blackTime: gameState.blackTime,
        whiteTime: gameState.whiteTime,
        lastMoveTimestamp: gameState.lastMoveTimestamp,
        lastMoveWasPass: gameState.lastMoveWasPass
    });
}

function disconnect() {
    stopHeartbeat();
    if (dataChannel) { dataChannel.close(); dataChannel=null; }
    if (pc) { pc.close(); pc=null; }
    if (ws) { ws.close(); ws=null; }
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
}

function startGame() {
    // 如果已经在对局中且不是重连，直接返回
    if (gameState.inGame && !gameState.isReconnect) return;
    
    const wasReconnect = gameState.isReconnect;
    gameState.inGame = true;
    
    // 如果不是重连，才初始化棋盘
    if (!wasReconnect) {
        initBoard();
    }
    gameState.isReconnect = false;
    
    closeDialog();
    document.getElementById('undoBtn').disabled = false;
    document.getElementById('passBtn').disabled = false;
    document.getElementById('endBtn').disabled = false;
    document.getElementById('countBtn').disabled = false;  // 启用数子按钮
    document.getElementById('undoBtn').style.display = 'flex';
    document.getElementById('passBtn').style.display = 'flex';
    document.getElementById('endBtn').style.display = 'flex';
    document.getElementById('countBtn').style.display = 'flex';  // 显示数子按钮
    document.getElementById('confirmBtn').style.display = 'none';  // 隐藏确定按钮
    selectedPosition = null;  // 清除预览
    
    // 发送状态同步消息（包含名称和完整状态）
    sendStateSync();
    
    if (gameState.myColor==='black') {
        document.getElementById('blackName').textContent = gameState.myName;
        document.getElementById('whiteName').textContent = gameState.opponentName || '白方';
    } else {
        document.getElementById('blackName').textContent = gameState.opponentName || '黑方';
        document.getElementById('whiteName').textContent = gameState.myName;
    }
    
    // 重连时不重置时间
    if (!wasReconnect) {
        gameState.blackTime = gameState.timeLimit * 60;
        gameState.whiteTime = gameState.timeLimit * 60;
    }
    updateTimeDisplay();
    
    // 重连时不重新放置让子
    if (!wasReconnect && gameState.handicap > 0) placeHandicapStones();
    
    // 重连时不重置当前玩家
    if (!wasReconnect) {
        gameState.currentPlayer = 'black';
    }
    updateCurrentPlayer();
    renderBoard();
    
    // 重连时启动倒计时
    if (wasReconnect) {
        startTimer();
    }
    
    showToast('对局开始');
}

function initBoard() {
    gameState.board = [];
    for (let i=0; i<BOARD_SIZE; i++) {
        gameState.board[i] = [];
        for (let j=0; j<BOARD_SIZE; j++) gameState.board[i][j] = null;
    }
    gameState.moveHistory = [];
    gameState.lastMoveWasPass = false;
    gameState.gameEnded = false;
}

function placeHandicapStones() {
    const pos = {
        2:[[3,15],[15,3]], 3:[[3,15],[15,3],[15,15]], 4:[[3,15],[15,3],[3,3],[15,15]],
        5:[[3,15],[15,3],[3,3],[15,15],[9,9]], 6:[[3,15],[15,3],[3,3],[15,15],[3,9],[15,9]],
        7:[[3,15],[15,3],[3,3],[15,15],[3,9],[15,9],[9,9]], 8:[[3,15],[15,3],[3,3],[15,15],[3,9],[15,9],[9,3],[9,15]],
        9:[[3,15],[15,3],[3,3],[15,15],[3,9],[15,9],[9,3],[9,15],[9,9]]
    };
    for (const [x,y] of (pos[gameState.handicap]||[])) gameState.board[x][y] = 'black';
}

function isMyTurn() { return gameState.currentPlayer === gameState.myColor && !gameState.gameEnded; }

function updateCurrentPlayer() {
    document.getElementById('blackTime').classList.toggle('active', gameState.currentPlayer==='black');
    document.getElementById('whiteTime').classList.toggle('active', gameState.currentPlayer==='white');
    // 不再切换棋盘灰显，通过状态栏提示
    if (gameState.currentPlayer === gameState.myColor) {
        document.getElementById('gameStatus').textContent = '请落子';
    } else {
        document.getElementById('gameStatus').textContent = '等待对手落子';
        // 不是自己的回合，隐藏确定按钮，恢复其他按钮
        if (selectedPosition) {
            selectedPosition = null;
            document.getElementById('confirmBtn').style.display = 'none';
            showToolbarButtons();
            renderBoard();
        }
    }
}

function updateTimeDisplay() {
    document.getElementById('blackTime').textContent = formatTime(gameState.blackTime);
    document.getElementById('whiteTime').textContent = formatTime(gameState.whiteTime);
    document.getElementById('blackTime').classList.toggle('low', gameState.blackTime<60);
    document.getElementById('whiteTime').classList.toggle('low', gameState.whiteTime<60);
}

function startTimer() {
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    gameState.timerInterval = setInterval(() => {
        if (gameState.gameEnded) { clearInterval(gameState.timerInterval); return; }
        if (gameState.currentPlayer==='black') {
            gameState.blackTime--;
            if (gameState.blackTime<=0) endGame('黑方超时');
        } else {
            gameState.whiteTime--;
            if (gameState.whiteTime<=0) endGame('白方超时');
        }
        updateTimeDisplay();
    }, 1000);
}

function handleClick(e) {
    // 不是自己的回合，不允许点击
    if (!isMyTurn()) return;
    
    const canvas = document.getElementById('board');
    const rect = canvas.getBoundingClientRect();
    const cellSize = rect.width / (BOARD_SIZE + 1);
    const x = Math.round((e.clientX - rect.left) / cellSize) - 1;
    const y = Math.round((e.clientY - rect.top) / cellSize) - 1;
    
    if (x<0 || x>=BOARD_SIZE || y<0 || y>=BOARD_SIZE) return;
    if (gameState.board[x][y] !== null) {
        // 点击已有棋子的位置，清除选中，恢复按钮显示
        selectedPosition = null;
        document.getElementById('confirmBtn').style.display = 'none';
        showToolbarButtons();
        renderBoard();
        return;
    }
    
    // 点击空位，显示预览
    selectedPosition = { x, y };
    renderBoard();
    
    // 显示确定按钮
    hideToolbarButtons();
    document.getElementById('confirmBtn').style.display = 'flex';
}

function hideToolbarButtons() {
    document.getElementById('undoBtn').style.display = 'none';
    document.getElementById('passBtn').style.display = 'none';
    document.getElementById('endBtn').style.display = 'none';
    document.getElementById('countBtn').style.display = 'none';
}

function showToolbarButtons() {
    document.getElementById('undoBtn').style.display = 'flex';
    document.getElementById('passBtn').style.display = 'flex';
    document.getElementById('endBtn').style.display = 'flex';
    document.getElementById('countBtn').style.display = 'flex';
}

function confirmMove() {
    if (!selectedPosition) return;
    if (!isMyTurn()) return;
    
    const { x, y } = selectedPosition;
    selectedPosition = null;
    document.getElementById('confirmBtn').style.display = 'none';
    showToolbarButtons();  // 恢复其他按钮显示
    placeStone(x, y);
}

function placeStone(x, y) {
    if (gameState.board[x][y] !== null) return;
    if (!checkCapture(x,y,gameState.currentPlayer) && !hasLiberty(x,y,gameState.currentPlayer)) { showToast('禁止自杀'); return; }
    gameState.board[x][y] = gameState.currentPlayer;
    gameState.moveHistory.push({ x, y, color: gameState.currentPlayer });
    removeDeadStones(x, y, gameState.currentPlayer==='black'?'white':'black');
    gameState.lastMoveWasPass = false;
    gameState.lastMoveTimestamp = Date.now();  // 更新最后落子时间
    selectedPosition = null;  // 清除预览
    document.getElementById('confirmBtn').style.display = 'none';  // 隐藏确定按钮
    showToolbarButtons();  // 恢复其他按钮显示
    // 发送 move 消息，携带时间
    sendGameMessage({ 
        type:'move', 
        x, 
        y, 
        color: gameState.currentPlayer,
        blackTime: gameState.blackTime,
        whiteTime: gameState.whiteTime
    });
    switchPlayer();
    renderBoard();
    saveGameState();
}

function checkCapture(x, y, c) {
    const o = c==='black'?'white':'black';
    for (const [nx,ny] of getNeighbors(x,y)) {
        if (gameState.board[nx]?.[ny]===o && !hasLiberty(nx,ny,o)) return true;
    }
    return false;
}

function removeDeadStones(x, y, c) {
    for (const [nx,ny] of getNeighbors(x,y)) {
        if (gameState.board[nx]?.[ny]===c && !hasLiberty(nx,ny,c)) removeGroup(nx,ny,c);
    }
}

function hasLiberty(x, y, c, v=new Set()) {
    const k = x+','+y;
    if (v.has(k)) return false;
    v.add(k);
    for (const [nx,ny] of getNeighbors(x,y)) {
        if (gameState.board[nx]?.[ny]===null) return true;
        if (gameState.board[nx]?.[ny]===c && hasLiberty(nx,ny,c,v)) return true;
    }
    return false;
}

function removeGroup(x, y, c, v=new Set()) {
    const k = x+','+y;
    if (v.has(k)) return;
    v.add(k);
    if (gameState.board[x]?.[y] !== c) return;
    gameState.board[x][y] = null;
    for (const [nx,ny] of getNeighbors(x,y)) {
        if (gameState.board[nx]?.[ny]===c) removeGroup(nx,ny,c,v);
    }
}

function getNeighbors(x, y) {
    const n = [];
    if (x>0) n.push([x-1,y]);
    if (x<BOARD_SIZE-1) n.push([x+1,y]);
    if (y>0) n.push([x,y-1]);
    if (y<BOARD_SIZE-1) n.push([x,y+1]);
    return n;
}

function switchPlayer() {
    gameState.currentPlayer = gameState.currentPlayer==='black'?'white':'black';
    updateCurrentPlayer();
    startTimer();
}

function handleStateSync(d) {
    console.log('Received state-sync:', d);
    
    // 同步对手名称
    gameState.opponentName = d.name;
    if (gameState.myColor==='black') {
        document.getElementById('whiteName').textContent = d.name || '白方';
    } else {
        document.getElementById('blackName').textContent = d.name || '黑方';
    }
    
    // 版本判断：谁的着法串长，谁的版本更新
    const myVersion = gameState.moveHistory ? gameState.moveHistory.length : 0;
    const theirVersion = d.moveHistory ? d.moveHistory.length : 0;
    
    console.log('Version comparison - Me:', myVersion, 'Opponent:', theirVersion);
    
    if (theirVersion > myVersion) {
        // 对方版本更新，同步对方的状态
        console.log('Syncing to opponent state');
        
        // 同步棋盘和着法历史
        gameState.board = d.board;
        gameState.moveHistory = d.moveHistory;
        gameState.currentPlayer = d.currentPlayer;
        gameState.lastMoveWasPass = d.lastMoveWasPass;
        
        // 同步对局条件
        gameState.handicap = d.handicap;
        gameState.timeLimit = d.timeLimit;
        
        // 同步时间
        gameState.blackTime = d.blackTime;
        gameState.whiteTime = d.whiteTime;
        
        // 如果有最后落子时间戳，计算断线期间消耗的时间
        if (d.lastMoveTimestamp && d.currentPlayer) {
            const elapsed = Math.floor((Date.now() - d.lastMoveTimestamp) / 1000);
            console.log('Time elapsed since last move:', elapsed, 'seconds');
            
            // 从当前玩家的剩余时间中扣除消耗的时间
            if (d.currentPlayer === 'black') {
                gameState.blackTime = Math.max(0, d.blackTime - elapsed);
            } else {
                gameState.whiteTime = Math.max(0, d.whiteTime - elapsed);
            }
            
            // 更新最后落子时间戳为当前时间
            gameState.lastMoveTimestamp = Date.now();
        } else {
            gameState.lastMoveTimestamp = d.lastMoveTimestamp;
        }
        
        // 更新显示
        updateTimeDisplay();
        updateCurrentPlayer();
        renderBoard();
        
        // 启动倒计时
        startTimer();
        
        // 保存到本地存储
        saveGameState();
        
        showToast('状态已同步');
    } else if (myVersion > theirVersion) {
        // 我的版本更新，发送我的状态给对方
        console.log('My version is newer, sending my state');
        sendStateSync();
    } else {
        // 版本相同，不需要同步
        console.log('Versions match, no sync needed');
    }
}

function handleGameMessage(d) {
    console.log('Received P2P message:', d.type, d);
    switch(d.type) {
        case 'heartbeat':
            // P2P 心跳，检查版本号
            const myVersion = gameState.moveHistory ? gameState.moveHistory.length : 0;
            if (d.version !== myVersion) {
                console.log('Heartbeat version mismatch - Me:', myVersion, 'Opponent:', d.version);
                // 版本不同，触发状态同步
                sendStateSync();
            }
            break;
        case 'state-sync':
            // P2P 连接建立后的状态同步
            handleStateSync(d);
            break;
        case 'name-sync':
            gameState.opponentName = d.name;
            // 更新显示
            if (gameState.myColor==='black') {
                document.getElementById('whiteName').textContent = d.name || '白方';
            } else {
                document.getElementById('blackName').textContent = d.name || '黑方';
            }
            break;
        case 'move':
            gameState.board[d.x][d.y] = d.color;
            gameState.moveHistory.push({ x:d.x, y:d.y, color:d.color });
            removeDeadStones(d.x, d.y, d.color==='black'?'white':'black');
            gameState.lastMoveWasPass = false;
            gameState.lastMoveTimestamp = Date.now();  // 更新最后落子时间
            // 同步时间
            if (d.blackTime !== undefined) gameState.blackTime = d.blackTime;
            if (d.whiteTime !== undefined) gameState.whiteTime = d.whiteTime;
            selectedPosition = null;  // 清除预览
            document.getElementById('confirmBtn').style.display = 'none';  // 隐藏确定按钮
            showToolbarButtons();  // 恢复其他按钮显示
            switchPlayer();
            renderBoard();
            updateTimeDisplay();  // 更新时间显示
            saveGameState();
            break;
        case 'pass':
            // 同步时间
            if (d.blackTime !== undefined) gameState.blackTime = d.blackTime;
            if (d.whiteTime !== undefined) gameState.whiteTime = d.whiteTime;
            showToast((d.color==='black'?'黑方':'白方')+'停一手');
            
            if (gameState.lastMoveWasPass) {
                // 双方连续 Pass，触发数子
                gameState.lastMoveWasPass = false;
                showToast('双方停手，开始数子...');
                doCount();
            } else {
                gameState.lastMoveWasPass = true;
                gameState.lastMoveTimestamp = Date.now();
                switchPlayer();
                updateTimeDisplay();
                saveGameState();
            }
            break;
        case 'undo-request':
            // 请求者想悔棋，对手同意后双方都执行撤销
            window._undoRequester = d.name;
            document.getElementById('dialogContainer').innerHTML = 
            '<div class="dialog-overlay"><div class="dialog">'+
            '<div class="dialog-title">悔棋请求</div>'+
            '<div style="text-align:center;margin-bottom:16px">'+d.name+' 请求悔棋</div>'+
            '<button class="btn btn-primary" onclick="respondUndo(true)">同意</button>'+
            '<button class="btn btn-secondary" onclick="respondUndo(false)">拒绝</button></div></div>';
            break;
        case 'undo-response':
            closeDialog();
            if (d.accept) {
                if (gameState.moveHistory.length === 0) return;
                // 找到我的最后一手
                let myLastIndex = -1;
                for (let i=gameState.moveHistory.length-1; i>=0; i--) {
                    if (gameState.moveHistory[i].color === gameState.myColor) {
                        myLastIndex = i;
                        break;
                    }
                }
                if (myLastIndex >= 0) {
                    // 撤销从末尾到我的最后一手（包括我的最后一手）
                    while (gameState.moveHistory.length > myLastIndex) {
                        const m = gameState.moveHistory.pop();
                        gameState.board[m.x][m.y] = null;
                    }
                    // 轮次回到请求者（我）
                    gameState.currentPlayer = gameState.myColor;
                    gameState.lastMoveTimestamp = Date.now();  // 更新时间戳
                    selectedPosition = null;  // 清除预览
                    document.getElementById('confirmBtn').style.display = 'none';  // 隐藏确定按钮
                    showToolbarButtons();  // 恢复其他按钮显示
                    updateCurrentPlayer();
                    renderBoard();
                    saveGameState();
                    showToast('悔棋成功');
                }
            } else showToast('对方拒绝悔棋');
            break;
        case 'resign':
            endGame((d.color==='black'?'黑方':'白方')+'认输');
            break;
        case 'game-end':
            // 对手通知对局结束
            if (d.scoreLead !== undefined) {
                // 数子结束，显示胜负
                gameState.gameEnded = true;
                if (gameState.timerInterval) clearInterval(gameState.timerInterval);
                localStorage.removeItem('hh-game-state');
                saveGameRecord('数子: ' + (d.scoreLead > 0 ? '黑胜' : '白胜') + ' ' + Math.abs(d.scoreLead).toFixed(1) + '目');
                showGameEndDialog(d.scoreLead);
            } else {
                // 其他结束原因
                endGame(d.reason);
            }
            break;
        case 'request-count':
            // 对手申请数子
            document.getElementById('dialogContainer').innerHTML = 
            '<div class="dialog-overlay"><div class="dialog">'+
            '<div class="dialog-title">数子请求</div>'+
            '<div style="text-align:center;margin-bottom:16px">'+d.from+' 申请数子</div>'+
            '<button class="btn btn-primary" onclick="respondCount(true)" style="margin-right:8px">同意</button>'+
            '<button class="btn btn-secondary" onclick="respondCount(false)" style="margin-left:8px">拒绝</button></div></div>';
            break;
        case 'count-response':
            closeDialog();
            if (d.agree) {
                showToast('对手同意数子，开始分析...');
                // 双方都开始数子
                doCount();
            } else {
                showToast('对手拒绝数子');
                gameState.countRequested = false;
                gameState.countRequestedBy = null;
            }
            break;
        case 'count-trigger':
            // 对手触发数子，我也开始
            showToast('开始数子...');
            doCount();
            break;
        case 'count-result':
            // 收到对手的数子结果
            gameState.opponentCountResult = d.scoreLead;
            console.log('收到对手数子结果:', d.scoreLead);
            
            // 如果我也完成了，合并结果
            if (gameState.myCountResult !== null) {
                mergeCountResults();
            }
            break;
    }
}

// 回应数子请求
function respondCount(agree) {
    closeDialog();
    sendGameMessage({ type: 'count-response', agree: agree });
    if (agree) {
        showToast('同意数子，开始分析...');
        doCount();
    }
}

// 合并双方数子结果
function mergeCountResults() {
    // 避免重复调用
    if (gameState.gameEnded) {
        console.log('对局已结束，跳过重复合并');
        return;
    }
    
    const myResult = gameState.myCountResult;
    const opponentResult = gameState.opponentCountResult;
    
    console.log('合并数子结果 - 我:', myResult, '对手:', opponentResult);
    
    // 检查一致性
    const diff = Math.abs(myResult - opponentResult);
    if (diff > 1) {
        console.warn('数子结果差异较大:', diff, '目');
    }
    
    // 取平均值作为最终结果
    const finalScore = (myResult + opponentResult) / 2;
    
    // 结束对局
    gameState.gameEnded = true;
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    localStorage.removeItem('hh-game-state');
    
    // 发送带结果的结束消息
    sendGameMessage({ 
        type: 'game-end', 
        reason: '数子结束',
        scoreLead: finalScore
    });
    
    saveGameRecord('数子: ' + (finalScore > 0 ? '黑胜' : '白胜') + ' ' + Math.abs(finalScore).toFixed(1) + '目');
    
    showGameEndDialog(finalScore);
}

function passMove() {
    if (!isMyTurn()) return;
    gameState.lastMoveTimestamp = Date.now();  // 更新最后 Pass 时间
    // 发送 pass 消息，携带时间
    sendGameMessage({ 
        type:'pass', 
        color: gameState.myColor,
        blackTime: gameState.blackTime,
        whiteTime: gameState.whiteTime
    });
    if (gameState.lastMoveWasPass) {
        // 双方连续 Pass，触发数子
        showToast('双方停手，开始数子...');
        gameState.lastMoveWasPass = false;
        doCount();
    } else { 
        gameState.lastMoveWasPass = true; 
        showToast('你停一手'); 
        switchPlayer(); 
        saveGameState(); 
    }
}

// 请求数子
function requestCount() {
    if (gameState.gameEnded) return;
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog">'+
    '<div class="dialog-title">申请数子</div>'+
    '<div style="text-align:center;margin-bottom:16px">确定要申请数子吗？</div>'+
    '<button class="btn btn-primary" onclick="confirmCountRequest()">确定</button>'+
    '<button class="btn btn-secondary" onclick="closeDialog()">取消</button></div></div>';
}

function confirmCountRequest() {
    closeDialog();
    sendGameMessage({ type: 'request-count', from: gameState.myName });
    gameState.countRequested = true;
    gameState.countRequestedBy = 'me';
    showToast('已发送数子请求');
}

// 执行数子（调用 AI）
async function doCount() {
    showToast('AI 正在分析...');
    
    // 重置数子结果
    gameState.myCountResult = null;
    gameState.opponentCountResult = null;
    
    try {
        // 初始化 AI（如果还没初始化）
        if (!aiInitialized) {
            await initAI();
        }
        
        if (!aiEngine) {
            throw new Error('AI 未初始化');
        }
        
        // 构建棋盘状态
        const board = gameState.board.map(row => row.map(cell => cell));
        const currentPlayer = gameState.currentPlayer;
        const moveHistory = gameState.moveHistory.map(m => ({ x: m.x, y: m.y, player: m.color }));
        
        // 调用 AI 分析
        const analysis = await aiEngine.analyze(
            board,
            null,  // previousBoard
            currentPlayer,
            moveHistory,
            7.5,   // komi
            200     // visits
        );
        
        const scoreLead = analysis.rootScoreLead;
        gameState.myCountResult = scoreLead;
        
        // 发送结果给对手
        sendGameMessage({ 
            type: 'count-result', 
            scoreLead: scoreLead
        });
        
        showToast('分析完成，等待对手结果...');
        
        // 检查是否已收到对手结果
        if (gameState.opponentCountResult !== null) {
            mergeCountResults();
        }
        
    } catch (error) {
        console.error('数子失败:', error);
        showToast('数子失败，使用简单估算...');
        // 回退：使用简单估算
        const blackCount = countStones('black');
        const whiteCount = countStones('white');
        const estimatedScore = blackCount - whiteCount - 7.5;
        gameState.myCountResult = estimatedScore;
        sendGameMessage({ type: 'count-result', scoreLead: estimatedScore });
        
        // 检查是否已收到对手结果
        if (gameState.opponentCountResult !== null) {
            mergeCountResults();
        }
    }
}

// 简单数子（备用方案）
function countStones(color) {
    let count = 0;
    for (let i = 0; i < BOARD_SIZE; i++) {
        for (let j = 0; j < BOARD_SIZE; j++) {
            if (gameState.board[i][j] === color) count++;
        }
    }
    return count;
}

// AI Worker 相关变量
let aiWorker = null;
let aiPendingRequests = new Map();
let aiRequestCounter = 0;

// 初始化 AI
async function initAI() {
    try {
        // 直接创建 KataGo Worker
        aiWorker = new Worker('./assets/worker.js', { type: 'module' });
        
        aiWorker.onmessage = (e) => {
            const data = e.data;
            
            if (data.type === 'katago:init_result') {
                const pending = aiPendingRequests.get('init');
                if (pending) {
                    if (data.ok) pending.resolve();
                    else pending.reject(new Error(data.error || 'Init failed'));
                    aiPendingRequests.delete('init');
                }
            } else if (data.type === 'katago:analyze_result' || data.type === 'katago:analyze_update') {
                const pending = aiPendingRequests.get(data.id);
                if (pending) {
                    if (data.ok && data.analysis) {
                        pending.resolve(data.analysis);
                        aiPendingRequests.delete(data.id);
                    } else if (data.error && data.error !== 'canceled') {
                        pending.reject(new Error(data.error));
                        aiPendingRequests.delete(data.id);
                    }
                }
            }
        };
        
        aiWorker.onerror = (e) => {
            console.error('AI Worker error:', e);
        };
        
        // 初始化模型
        await new Promise((resolve, reject) => {
            aiPendingRequests.set('init', { resolve, reject });
            aiWorker.postMessage({ type: 'katago:init', modelUrl: './models/katago-small.bin.gz' });
        });
        
        // 创建 AI 引擎接口
        aiEngine = {
            analyze: async (board, previousBoard, currentPlayer, moveHistory, komi, visits) => {
                const id = ++aiRequestCounter;
                return new Promise((resolve, reject) => {
                    aiPendingRequests.set(id, { resolve, reject });
                    aiWorker.postMessage({
                        type: 'katago:analyze',
                        id: id,
                        modelUrl: './models/katago-small.bin.gz',
                        board: board,
                        previousBoard: previousBoard,
                        currentPlayer: currentPlayer,
                        moveHistory: moveHistory.slice(-30),
                        komi: komi,
                        visits: visits,
                        maxTimeMs: 10000
                    });
                    
                    // 超时处理
                    setTimeout(() => {
                        if (aiPendingRequests.has(id)) {
                            aiPendingRequests.delete(id);
                            reject(new Error('AI analysis timeout'));
                        }
                    }, 15000);
                });
            }
        };
        
        aiInitialized = true;
        console.log('AI 引擎已初始化');
        
    } catch (error) {
        console.error('AI 初始化失败:', error);
        // 创建一个模拟引擎
        aiEngine = {
            analyze: async () => ({
                rootWinRate: 0.5,
                rootScoreLead: (Math.random() - 0.5) * 10,
                moves: []
            })
        };
        aiInitialized = true;
    }
}

// 显示对局结束对话框
function showGameEndDialog(scoreLead) {
    let resultText;
    if (Math.abs(scoreLead) < 0.5) {
        resultText = '和棋';
    } else if (scoreLead > 0) {
        resultText = `黑方胜 ${scoreLead.toFixed(1)} 目`;
    } else {
        resultText = `白方胜 ${Math.abs(scoreLead).toFixed(1)} 目`;
    }
    
    const moveCount = gameState.moveHistory.length;
    const blackCaptures = gameState.moveHistory.filter(m => m.color === 'white').length;
    const whiteCaptures = gameState.moveHistory.filter(m => m.color === 'black').length;
    
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog" style="min-width:300px">'+
    '<div class="dialog-title" style="font-size:18px">🎉 对局结束</div>'+
    '<div style="text-align:center;font-size:20px;font-weight:bold;margin:16px 0">'+resultText+'</div>'+
    '<div style="text-align:center;color:#666;font-size:13px;margin-bottom:16px">'+
    '<div>总手数: '+moveCount+'</div>'+
    '<div>提子: 黑方 '+blackCaptures+' / 白方 '+whiteCaptures+'</div>'+
    '</div>'+
    '<button class="btn btn-primary" onclick="location.reload()">再来一局</button>'+
    '</div></div>';
}

function requestUndo() {
    if (gameState.moveHistory.length === 0) { showToast('没有可悔的棋'); return; }
    // 找到我的最后一手
    let myLastIndex = -1;
    for (let i=gameState.moveHistory.length-1; i>=0; i--) {
        if (gameState.moveHistory[i].color === gameState.myColor) {
            myLastIndex = i;
            break;
        }
    }
    if (myLastIndex < 0) { showToast('没有可悔的棋'); return; }
    sendGameMessage({ type:'undo-request', name: gameState.myName });
    showToast('已发送悔棋请求');
}

function respondUndo(accept) {
    closeDialog();
    sendGameMessage({ type:'undo-response', accept });
    if (accept) {
        if (gameState.moveHistory.length === 0) return;
        // 找到请求者（对手）的最后一手
        const requesterColor = (gameState.myColor==='black'?'white':'black');
        let requesterLastIndex = -1;
        for (let i=gameState.moveHistory.length-1; i>=0; i--) {
            if (gameState.moveHistory[i].color === requesterColor) {
                requesterLastIndex = i;
                break;
            }
        }
        if (requesterLastIndex >= 0) {
            // 撤销从末尾到请求者的最后一手（包括请求者的最后一手）
            while (gameState.moveHistory.length > requesterLastIndex) {
                const m = gameState.moveHistory.pop();
                gameState.board[m.x][m.y] = null;
            }
            // 轮次回到请求者
            gameState.currentPlayer = requesterColor;
            gameState.lastMoveTimestamp = Date.now();  // 更新时间戳
            selectedPosition = null;  // 清除预览
            document.getElementById('confirmBtn').style.display = 'none';  // 隐藏确定按钮
            showToolbarButtons();  // 恢复其他按钮显示
            updateCurrentPlayer();
            renderBoard();
            saveGameState();
            showToast('同意悔棋');
        }
    }
}

function requestEnd() {
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog">'+
    '<div class="dialog-title">结束对局</div>'+
    '<div style="text-align:center;margin-bottom:16px">确定要认输吗？</div>'+
    '<button class="btn btn-danger" onclick="confirmEnd()">认输</button>'+
    '<button class="btn btn-secondary" onclick="closeDialog()">取消</button></div></div>';
}

function confirmEnd() {
    closeDialog();
    sendGameMessage({ type:'resign', color: gameState.myColor });
    endGame('你认输');
}

function endGame(reason) {
    // 避免重复调用
    if (gameState.gameEnded) {
        console.log('对局已结束，跳过重复调用');
        return;
    }
    gameState.gameEnded = true;
    
    // 通���对手对局结束（仅发送一次）
    if (dataChannel && dataChannel.readyState === 'open') {
        sendGameMessage({ type: 'game-end', reason: reason });
    }
    
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    if (gameState.reconnectTimeout) {
        clearTimeout(gameState.reconnectTimeout);
        gameState.reconnectTimeout = null;
    }
    if (gameState.reconnectCountdownTimer) {
        clearInterval(gameState.reconnectCountdownTimer);
        gameState.reconnectCountdownTimer = null;
    }
    localStorage.removeItem('hh-game-state');
    showToast('对局结束: '+reason);
    saveGameRecord(reason);
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog">'+
    '<div class="dialog-title">对局结束</div>'+
    '<div style="text-align:center;margin-bottom:16px">'+reason+'</div>'+
    '<button class="btn btn-primary" onclick="location.reload()">再来一局</button></div></div>';
}

function saveGameRecord(reason) {
    const record = {
        date: new Date().toISOString(),
        black: gameState.myColor==='black'?gameState.myName:gameState.opponentName,
        white: gameState.myColor==='white'?gameState.myName:gameState.opponentName,
        result: reason,
        moves: gameState.moveHistory,
        handicap: gameState.handicap
    };
    const records = JSON.parse(localStorage.getItem('weiqi-game-records')||'[]');
    records.unshift(record);
    if (records.length > 50) records.pop();
    localStorage.setItem('weiqi-game-records', JSON.stringify(records));
}

function renderBoard() {
    const canvas = document.getElementById('board');
    const ctx = canvas.getContext('2d');
    
    // 根据是否轮到自己设置鼠标样式
    canvas.style.cursor = isMyTurn() ? 'pointer' : 'not-allowed';
    
    const size = canvas.parentElement.clientWidth;
    canvas.width = size;
    canvas.height = size;
    const cellSize = size / (BOARD_SIZE + 1);
    const stoneR = cellSize * STONE_RADIUS_RATIO;
    
    ctx.fillStyle = '#E3C16F';
    ctx.fillRect(0, 0, size, size);
    
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 1;
    for (let i=0; i<BOARD_SIZE; i++) {
        const p = cellSize * (i+1);
        ctx.beginPath(); ctx.moveTo(cellSize, p); ctx.lineTo(size-cellSize, p); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p, cellSize); ctx.lineTo(p, size-cellSize); ctx.stroke();
    }
    
    ctx.fillStyle = '#8B4513';
    for (const [x,y] of [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]]) {
        ctx.beginPath();
        ctx.arc(cellSize*(x+1), cellSize*(y+1), 4, 0, Math.PI*2);
        ctx.fill();
    }
    
    for (let i=0; i<BOARD_SIZE; i++) {
        for (let j=0; j<BOARD_SIZE; j++) {
            if (gameState.board[i][j]) {
                const x = cellSize*(i+1), y = cellSize*(j+1);
                ctx.beginPath();
                ctx.arc(x+2, y+2, stoneR, 0, Math.PI*2);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fill();
                
                const g = ctx.createRadialGradient(x-stoneR*0.3, y-stoneR*0.3, 0, x, y, stoneR);
                if (gameState.board[i][j]==='black') { g.addColorStop(0, '#666'); g.addColorStop(1, '#000'); }
                else { g.addColorStop(0, '#fff'); g.addColorStop(1, '#ccc'); }
                ctx.beginPath();
                ctx.arc(x, y, stoneR, 0, Math.PI*2);
                ctx.fillStyle = g;
                ctx.fill();
            }
        }
    }
    
    if (gameState.moveHistory.length > 0) {
        const last = gameState.moveHistory[gameState.moveHistory.length-1];
        ctx.beginPath();
        ctx.arc(cellSize*(last.x+1), cellSize*(last.y+1), stoneR*0.3, 0, Math.PI*2);
        ctx.fillStyle = last.color==='black'?'#fff':'#000';
        ctx.fill();
    }
    
    // 如果对手停一手，显示明显提示
    if (gameState.lastMoveWasPass) {
        const passText = '对手停一手';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // 半透明背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        const textWidth = ctx.measureText(passText).width;
        const padding = 20;
        ctx.fillRect(size/2 - textWidth/2 - padding, size/2 - 20, textWidth + padding*2, 40);
        
        // 文字
        ctx.fillStyle = '#fff';
        ctx.fillText(passText, size/2, size/2);
    }
    
    // 绘制预览棋子（仅轮到自己时显示）
    if (selectedPosition && gameState.board[selectedPosition.x]?.[selectedPosition.y] === null && isMyTurn()) {
        const px = cellSize * (selectedPosition.x + 1);
        const py = cellSize * (selectedPosition.y + 1);
        ctx.globalAlpha = 0.5;
        const g = ctx.createRadialGradient(px-stoneR*0.3, py-stoneR*0.3, 0, px, py, stoneR);
        if (gameState.myColor === 'black') {
            g.addColorStop(0, '#666');
            g.addColorStop(1, '#000');
        } else {
            g.addColorStop(0, '#fff');
            g.addColorStop(1, '#ccc');
        }
        ctx.beginPath();
        ctx.arc(px, py, stoneR, 0, Math.PI*2);
        ctx.fillStyle = g;
        ctx.fill();
        if (gameState.myColor === 'white') {
            ctx.strokeStyle = '#bbb';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
}

function init() {
    initBoard();
    document.getElementById('board').addEventListener('click', handleClick);
    window.addEventListener('resize', renderBoard);
    renderBoard();
    
    // 检查是否有未完成的对局
    const savedGame = localStorage.getItem('hh-game-state');
    if (savedGame) {
        const saved = JSON.parse(savedGame);
        if (saved.room && saved.myName && saved.myColor) {
            // 尝试恢复连接
            showReconnectDialog(saved);
            return;
        }
    }
    
    showStartDialog();
}

function showReconnectDialog(saved) {
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog">'+
    '<div class="dialog-title">恢复对局</div>'+
    '<div style="margin-bottom:16px;text-align:center;color:#666">发现未完成的对局</div>'+
    '<div style="margin-bottom:12px;text-align:center">'+
    '<div style="font-size:13px;color:#666">房间 '+saved.room+'</div>'+
    '<div style="font-size:14px">'+saved.myName+' ('+(saved.myColor==='black'?'执黑':'执白')+')</div>'+
    '</div>'+
    '<button class="btn btn-primary" onclick="reconnectGame()">重新连接</button>'+
    '<button class="btn btn-secondary" onclick="clearSavedGame()">放弃对局</button>'+
    '</div></div>';
}

function reconnectGame() {
    const saved = JSON.parse(localStorage.getItem('hh-game-state'));
    gameState.room = saved.room;
    gameState.myName = saved.myName;
    gameState.myColor = saved.myColor;
    gameState.timeLimit = saved.timeLimit || 30;
    gameState.handicap = saved.handicap || 0;
    gameState.isCreator = saved.isCreator || false;
    gameState.inGame = true;
    gameState.isReconnect = true;  // 标记为重连
    
    closeDialog();
    showToast('重新连接中...');
    
    // 恢复棋盘状态
    if (saved.board) gameState.board = saved.board;
    if (saved.moveHistory) gameState.moveHistory = saved.moveHistory;
    if (saved.blackTime) gameState.blackTime = saved.blackTime;
    if (saved.whiteTime) gameState.whiteTime = saved.whiteTime;
    if (saved.currentPlayer) gameState.currentPlayer = saved.currentPlayer;
    if (saved.lastMoveTimestamp) gameState.lastMoveTimestamp = saved.lastMoveTimestamp;  // 恢复最后落子时间戳
    if (saved.opponentName) gameState.opponentName = saved.opponentName;
    
    // 启用按钮
    document.getElementById('undoBtn').disabled = false;
    document.getElementById('passBtn').disabled = false;
    document.getElementById('endBtn').disabled = false;
    document.getElementById('countBtn').disabled = false;  // 启用数子按钮
    document.getElementById('undoBtn').style.display = 'flex';
    document.getElementById('passBtn').style.display = 'flex';
    document.getElementById('endBtn').style.display = 'flex';
    document.getElementById('countBtn').style.display = 'flex';  // 显示数子按钮
    document.getElementById('confirmBtn').style.display = 'none';  // 隐藏确定按钮
    selectedPosition = null;  // 清除预览
    
    // 显示名称
    if (gameState.myColor==='black') {
        document.getElementById('blackName').textContent = gameState.myName;
        document.getElementById('whiteName').textContent = gameState.opponentName || '白方';
    } else {
        document.getElementById('blackName').textContent = gameState.opponentName || '黑方';
        document.getElementById('whiteName').textContent = gameState.myName;
    }
    updateTimeDisplay();
    updateCurrentPlayer();
    renderBoard();
    
    // 重新连接 WebSocket
    connectWebSocket(saved.room, saved.isCreator || false);
}

function clearSavedGame() {
    localStorage.removeItem('hh-game-state');
    closeDialog();
    showStartDialog();
}

function saveGameState() {
    localStorage.setItem('hh-game-state', JSON.stringify({
        room: gameState.room,
        myName: gameState.myName,
        myColor: gameState.myColor,
        opponentName: gameState.opponentName,
        timeLimit: gameState.timeLimit,
        handicap: gameState.handicap,
        isCreator: gameState.isCreator,
        board: gameState.board,
        moveHistory: gameState.moveHistory,
        blackTime: gameState.blackTime,
        whiteTime: gameState.whiteTime,
        currentPlayer: gameState.currentPlayer,
        lastMoveTimestamp: gameState.lastMoveTimestamp,  // 新增：保存最后落子时间戳
        lastMoveWasPass: gameState.lastMoveWasPass
    }));
}

function showStartDialog() {
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog">'+
    '<div class="dialog-title">人人对弈</div>'+
    '<div style="margin-bottom:16px;text-align:center;color:#666">选择开始方式</div>'+
    '<button class="btn btn-primary" onclick="showCreateDialog()">创建房间</button>'+
    '<button class="btn btn-secondary" onclick="showJoinDialog()">加入房间</button>'+
    '</div></div>';
}

function showWaitingReconnectDialog(timeout) {
    gameState.reconnectCountdown = timeout;
    document.getElementById('dialogContainer').innerHTML = 
    '<div class="dialog-overlay"><div class="dialog">'+
    '<div class="dialog-title">对手已离开</div>'+
    '<div style="margin-bottom:16px;text-align:center;color:#666">等待对手恢复连接...</div>'+
    '<div id="countdown" style="margin-bottom:16px;text-align:center;font-size:13px;color:#999">'+timeout+' 秒后自动结束</div>'+
    '<button class="btn btn-primary" onclick="giveUpWaiting()">放弃等待</button>'+
    '</div></div>';
    
    // 启动倒计时
    gameState.reconnectCountdownTimer = setInterval(() => {
        gameState.reconnectCountdown--;
        const el = document.getElementById('countdown');
        if (el && gameState.reconnectCountdown > 0) {
            el.textContent = gameState.reconnectCountdown + ' 秒后自动结束';
        }
        if (gameState.reconnectCountdown <= 0) {
            clearInterval(gameState.reconnectCountdownTimer);
        }
    }, 1000);
}

function giveUpWaiting() {
    if (gameState.reconnectTimeout) {
        clearTimeout(gameState.reconnectTimeout);
        gameState.reconnectTimeout = null;
    }
    if (gameState.reconnectCountdownTimer) {
        clearInterval(gameState.reconnectCountdownTimer);
        gameState.reconnectCountdownTimer = null;
    }
    localStorage.removeItem('hh-game-state');
    closeDialog();
    showStartDialog();
}

init();
