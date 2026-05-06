/**
 * 围棋定式棋盘渲染库
 * 用于定式探索和定式挑战页面
 * 
 * 功能：
 * - 19路棋盘，截取右上角13路显示
 * - 棋子绘制（含提子逻辑）
 * - 可选分支标记
 * - 播放控制
 */

(function(global) {
    'use strict';

    const BOARD_SIZE = 19;
    const DISPLAY_SIZE = 13;

    // ==================== 提子逻辑 ====================

    function getNeighbors(x, y) {
        const neighbors = [];
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE) {
                neighbors.push([nx, ny]);
            }
        }
        return neighbors;
    }

    function getGroup(board, x, y, color, group = null) {
        if (!group) group = new Set();
        const key = `${x},${y}`;
        if (group.has(key)) return group;
        if (board[y][x] !== color) return group;
        group.add(key);
        for (const [nx, ny] of getNeighbors(x, y)) {
            getGroup(board, nx, ny, color, group);
        }
        return group;
    }

    function getLiberties(board, x, y) {
        const color = board[y][x];
        if (!color) return new Set();
        const group = getGroup(board, x, y, color);
        const liberties = new Set();
        for (const key of group) {
            const [gx, gy] = key.split(',').map(Number);
            for (const [nx, ny] of getNeighbors(gx, gy)) {
                if (board[ny][nx] === null) liberties.add(`${nx},${ny}`);
            }
        }
        return liberties;
    }

    function removeDeadStones(board, x, y, color) {
        const opponent = color === 'black' ? 'white' : 'black';
        const removed = [];
        for (const [nx, ny] of getNeighbors(x, y)) {
            if (board[ny][nx] === opponent) {
                const liberties = getLiberties(board, nx, ny);
                if (liberties.size === 0) {
                    const group = getGroup(board, nx, ny, opponent);
                    for (const key of group) {
                        const [gx, gy] = key.split(',').map(Number);
                        board[gy][gx] = null;
                        removed.push([gx, gy]);
                    }
                }
            }
        }
        return removed;
    }

    // ==================== 棋盘状态管理 ====================

    function buildBoardState(moves) {
        const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
        const history = [];

        for (const move of moves) {
            if (move.isPass) {
                history.push({ move, captured: [] });
                continue;
            }
            if (move.x < 0 || move.x >= BOARD_SIZE || move.y < 0 || move.y >= BOARD_SIZE) {
                history.push({ move, captured: [] });
                continue;
            }

            board[move.y][move.x] = move.color;
            const captured = removeDeadStones(board, move.x, move.y, move.color);
            history.push({ move, captured });
        }

        return { board, history };
    }

    // ==================== 棋盘渲染 ====================

    class JosekiBoard {
        constructor(canvas, options = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.dpr = options.dpr || 1;
            this.options = {
                bgColor: options.bgColor || '#DCB35C',
                lineColor: options.lineColor || '#8B7355',
                showStars: options.showStars !== false,
                ...options
            };

            this.board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
            this.currentMoves = [];
            this.currentIndex = 0;
            this.branches = []; // 可选分支
            this.marks = [];   // 标记（正确/错误）
            this._passMark = null; // 脱先标记的位置和大小

            this.startX = BOARD_SIZE - DISPLAY_SIZE; // 6
            this.startY = 0;

            this.render();
        }

        resize(canvas, dpr) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.dpr = dpr || 1;
            this.render();
        }

        setMoves(moves, index = -1) {
            this.currentMoves = moves;
            this.currentIndex = index < 0 ? moves.length : index;
            this.branches = [];
            this.marks = [];
            this._rebuildBoard();
            this.render();
        }

        setBranches(branches) {
            // branches: [{x, y, freq}, ...]
            this.branches = branches || [];
            this.render();
        }

        setMarks(marks) {
            // marks: [{x, y, type: 'correct'|'wrong'}, ...]
            this.marks = marks || [];
            this.render();
        }

        goTo(index) {
            this.currentIndex = Math.max(0, Math.min(index, this.currentMoves.length));
            this._rebuildBoard();
            this.render();
        }

        next() {
            if (this.currentIndex < this.currentMoves.length) {
                this.goTo(this.currentIndex + 1);
                return true;
            }
            return false;
        }

        prev() {
            if (this.currentIndex > 0) {
                this.goTo(this.currentIndex - 1);
                return true;
            }
            return false;
        }

        _rebuildBoard() {
            const moves = this.currentMoves.slice(0, this.currentIndex);
            const { board } = buildBoardState(moves);
            this.board = board;
        }

        render() {
            const ctx = this.ctx;
            const canvasSize = this.canvas.width / this.dpr;

            ctx.save();
            ctx.scale(this.dpr, this.dpr);
            
            ctx.clearRect(0, 0, canvasSize, canvasSize);

            // 背景
            ctx.fillStyle = this.options.bgColor;
            ctx.fillRect(0, 0, canvasSize, canvasSize);

            // 网格
            const padding = canvasSize * 0.05;
            const gridSize = (canvasSize - padding * 2) / (DISPLAY_SIZE - 1);

            ctx.strokeStyle = this.options.lineColor;
            ctx.lineWidth = 1;

            for (let i = 0; i < DISPLAY_SIZE; i++) {
                // 竖线
                const x = padding + i * gridSize;
                ctx.beginPath();
                ctx.moveTo(x, padding);
                ctx.lineTo(x, canvasSize - padding);
                ctx.stroke();

                // 横线
                const y = padding + i * gridSize;
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(canvasSize - padding, y);
                ctx.stroke();
            }

            // 星位
            if (this.options.showStars) {
                ctx.fillStyle = '#333';
                const stars19 = [[15, 3], [9, 3]];
                for (const [sx, sy] of stars19) {
                    if (sx >= this.startX && sy >= this.startY && sy < this.startY + DISPLAY_SIZE) {
                        const localX = sx - this.startX;
                        const localY = sy - this.startY;
                        ctx.beginPath();
                        ctx.arc(padding + localX * gridSize, padding + localY * gridSize, Math.max(2, gridSize * 0.1), 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            // 棋子
            const stoneRadius = gridSize * 0.45;
            for (let y = 0; y < BOARD_SIZE; y++) {
                for (let x = 0; x < BOARD_SIZE; x++) {
                    const color = this.board[y][x];
                    if (!color) continue;

                    if (x >= this.startX && x < BOARD_SIZE && y >= this.startY && y < this.startY + DISPLAY_SIZE) {
                        const localX = x - this.startX;
                        const localY = y - this.startY;
                        this._drawStone(padding + localX * gridSize, padding + localY * gridSize, stoneRadius, color);
                    }
                }
            }

            // 可选分支标记（按热度区分大小和颜色深浅）
            ctx.save();
            
            // 计算热度范围（包括脱先）
            const allHeats = this.branches.map(b => b.heat || 0);
            const maxHeat = Math.max(...allHeats, 1);
            const minHeat = Math.min(...allHeats, 0);
            
            // 如果没有热度数据或只有一个选点，使用固定大小
            const hasHeatData = allHeats.some(h => h > 0);
            
            for (const branch of this.branches) {
                if (branch.isPass) {
                    // 脱先：固定在左下角
                    const cx = padding;  // 左边距处
                    const cy = canvasSize - padding;  // 下边距处
                    const heat = branch.heat || 0;
                    
                    // 根据是否有热度数据决定大小
                    let radius, alpha, lineWidth;
                    if (!hasHeatData) {
                        radius = gridSize * 0.35;
                        alpha = 0.5;
                        lineWidth = 2;
                    } else {
                        const logMin = Math.log(minHeat + 1);
                        const logMax = Math.log(maxHeat + 1);
                        const logHeat = Math.log(heat + 1);
                        const ratio = logMax > logMin ? (logHeat - logMin) / (logMax - logMin) : 0.5;
                        
                        const minRadius = gridSize * 0.12;
                        const maxRadius = gridSize * 0.30;
                        radius = minRadius + ratio * (maxRadius - minRadius);
                        
                        const minAlpha = 0.25;
                        const maxAlpha = 0.65;
                        alpha = minAlpha + ratio * (maxAlpha - minAlpha);
                        
                        const minLineWidth = 1;
                        const maxLineWidth = 3;
                        lineWidth = minLineWidth + ratio * (maxLineWidth - minLineWidth);
                    }
                    
                    // 和其他选点一样的颜色（黑方橙色，白方蓝色）
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                    if (branch.color === 'black') {
                        ctx.fillStyle = `rgba(255, 152, 0, ${alpha})`;
                        ctx.strokeStyle = '#FF9800';
                    } else {
                        ctx.fillStyle = `rgba(33, 150, 243, ${alpha})`;
                        ctx.strokeStyle = '#2196F3';
                    }
                    ctx.fill();
                    ctx.lineWidth = lineWidth;
                    ctx.stroke();
                    
                    // 显示“⊘”标记（和按钮一致）
                    ctx.fillStyle = '#fff';
                    ctx.font = `bold ${radius * 1.2}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('⊘', cx, cy);
                    
                    // 保存脱先标记的位置和大小，用于点击检测
                    this._passMark = { cx, cy, radius, heat };
                    
                    continue;
                }
                
                const displayX = branch.x - this.startX;
                const displayY = branch.y - this.startY;
                if (displayX >= 0 && displayX < DISPLAY_SIZE && displayY >= 0 && displayY < DISPLAY_SIZE) {
                    const cx = padding + displayX * gridSize;
                    const cy = padding + displayY * gridSize;

                    // 归一化热度到 0-1（对数尺度，让差距更明显）
                    const heat = branch.heat || 0;
                    
                    // 根据是否有热度数据决定大小
                    let radius, alpha, lineWidth;
                    if (!hasHeatData) {
                        // 无热度数据：使用固定大小
                        radius = gridSize * 0.35;
                        alpha = 0.5;
                        lineWidth = 2;
                    } else {
                        const logMin = Math.log(minHeat + 1);
                        const logMax = Math.log(maxHeat + 1);
                        const logHeat = Math.log(heat + 1);
                        const ratio = logMax > logMin ? (logHeat - logMin) / (logMax - logMin) : 0.5;
                        
                        // 根据热度计算圆圈大小（多档，整体缩小）
                        const minRadius = gridSize * 0.12;
                        const maxRadius = gridSize * 0.30;
                        radius = minRadius + ratio * (maxRadius - minRadius);
                        
                        const minAlpha = 0.25;
                        const maxAlpha = 0.65;
                        alpha = minAlpha + ratio * (maxAlpha - minAlpha);
                        
                        const minLineWidth = 1;
                        const maxLineWidth = 3;
                        lineWidth = minLineWidth + ratio * (maxLineWidth - minLineWidth);
                    }

                    // 半透明圆形标记
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                    
                    if (branch.color === 'black') {
                        // 黑棋位置：橙色半透明
                        ctx.fillStyle = `rgba(255, 152, 0, ${alpha})`;
                        ctx.strokeStyle = '#FF9800';
                    } else {
                        // 白棋位置：蓝色半透明
                        ctx.fillStyle = `rgba(33, 150, 243, ${alpha})`;
                        ctx.strokeStyle = '#2196F3';
                    }
                    ctx.fill();
                    ctx.lineWidth = lineWidth;
                    ctx.stroke();
                }
            }
            ctx.restore();

            // 正确/错误标记
            for (const mark of this.marks) {
                if (mark.x >= this.startX && mark.x < BOARD_SIZE && mark.y >= this.startY && mark.y < this.startY + DISPLAY_SIZE) {
                    const localX = mark.x - this.startX;
                    const localY = mark.y - this.startY;
                    const cx = padding + localX * gridSize;
                    const cy = padding + localY * gridSize;

                    ctx.font = `bold ${gridSize * 0.4}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    if (mark.type === 'correct') {
                        ctx.fillStyle = '#28a745';
                        ctx.fillText('✓', cx, cy);
                    } else if (mark.type === 'wrong') {
                        ctx.fillStyle = '#dc3545';
                        ctx.fillText('✗', cx, cy);
                    }
                }
            }

            // 手数标记（最后一手）
            if (this.currentIndex > 0) {
                const lastMove = this.currentMoves[this.currentIndex - 1];
                if (lastMove && !lastMove.isPass && lastMove.x >= this.startX && lastMove.y >= this.startY && lastMove.y < this.startY + DISPLAY_SIZE) {
                    const localX = lastMove.x - this.startX;
                    const localY = lastMove.y - this.startY;
                    const cx = padding + localX * gridSize;
                    const cy = padding + localY * gridSize;

                    ctx.font = `bold ${gridSize * 0.35}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = lastMove.color === 'black' ? '#fff' : '#000';
                    ctx.fillText(this.currentIndex.toString(), cx, cy);
                }
            }
            
            ctx.restore();
        }

        _drawStone(cx, cy, radius, color) {
            const ctx = this.ctx;

            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);

            const gradient = ctx.createRadialGradient(
                cx - radius * 0.3, cy - radius * 0.3, radius * 0.1,
                cx, cy, radius
            );

            if (color === 'black') {
                gradient.addColorStop(0, '#555');
                gradient.addColorStop(1, '#000');
            } else {
                gradient.addColorStop(0, '#fff');
                gradient.addColorStop(1, '#bbb');
            }

            ctx.fillStyle = gradient;
            ctx.fill();
            ctx.strokeStyle = color === 'black' ? '#333' : '#999';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }

        // 坐标转换：画布坐标 -> SGF坐标
        canvasToSgf(canvasX, canvasY) {
            // 先检查是否点击了脱先标记
            if (this._passMark) {
                const dx = canvasX - this._passMark.cx;
                const dy = canvasY - this._passMark.cy;
                if (Math.sqrt(dx * dx + dy * dy) <= this._passMark.radius) {
                    return { isPass: true };
                }
            }
            
            // canvasX/Y 已经是实际像素坐标
            const canvasSize = this.canvas.width; // 使用实际像素尺寸
            const padding = canvasSize * 0.05;
            const gridSize = (canvasSize - padding * 2) / (DISPLAY_SIZE - 1);

            const localX = Math.round((canvasX - padding) / gridSize);
            const localY = Math.round((canvasY - padding) / gridSize);

            if (localX < 0 || localX >= DISPLAY_SIZE || localY < 0 || localY >= DISPLAY_SIZE) {
                return null;
            }

            const x = this.startX + localX;
            const y = this.startY + localY;

            return { x, y, sgf: String.fromCharCode(97 + x, 97 + y) };
        }
    }

    // ==================== 工具函数 ====================

    function sgfToCoord(sgf) {
        if (!sgf || sgf.length !== 2) return null;
        if (sgf === 'tt') return { x: -1, y: -1, isPass: true };
        const x = sgf.charCodeAt(0) - 97;
        const y = sgf.charCodeAt(1) - 97;
        return { x, y, isPass: false };
    }

    function parseMoves(movesArray) {
        return movesArray.map((coord, i) => {
            const parsed = sgfToCoord(coord);
            return {
                ...parsed,
                color: i % 2 === 0 ? 'black' : 'white',
                num: i + 1
            };
        });
    }

    function formatFreq(freq) {
        return freq.toString();
    }

    function formatProb(prob) {
        if (prob === undefined || prob === null) return '-';
        return (prob * 100).toFixed(4) + '%';
    }

    // ==================== 导出 ====================

    global.JosekiBoard = JosekiBoard;
    global.JosekiUtils = {
        sgfToCoord,
        parseMoves,
        formatFreq,
        formatProb,
        buildBoardState,
        BOARD_SIZE,
        DISPLAY_SIZE
    };

})(window);
