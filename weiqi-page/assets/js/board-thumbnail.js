/**
 * 围棋定式缩略图绘制库
 * 用于在定式列表中显示小型棋盘预览
 * 
 * 绘制策略：19路坐标，固定截取右上角13路显示
 */

(function(global) {
    'use strict';

    /**
     * SGF 坐标转换为棋盘坐标
     * @param {string} sgfCoord - SGF 坐标 (如 "pd", "dd", "tt"表示pass)
     * @returns {Object|null} {x, y, isPass} 或 null
     */
    function sgfToCoord(sgfCoord) {
        if (!sgfCoord || sgfCoord.length !== 2) return null;
        
        // 处理脱先 (tt 或 aa)
        if (sgfCoord === 'tt' || sgfCoord === 'aa') {
            return { x: -1, y: -1, isPass: true };
        }
        
        const x = sgfCoord.charCodeAt(0) - 97; // 'a' = 97
        const y = sgfCoord.charCodeAt(1) - 97;
        if (x < 0 || x > 18 || y < 0 || y > 18) return null;
        return { x: x, y: y, isPass: false };
    }

    /**
     * 从 SGF 字符串解析着法
     * @param {string} sgf - SGF 格式字符串
     * @returns {Array} [{x, y, color, isPass}, ...]
     */
    function parseSgfMoves(sgf) {
        const moves = [];
        if (!sgf) return moves;

        const regex = /([BW])\[([a-s]{2}|tt|aa)\]/gi;
        let match;
        let moveNum = 0;

        while ((match = regex.exec(sgf)) !== null) {
            const color = match[1].toUpperCase() === 'B' ? 'black' : 'white';
            const coord = sgfToCoord(match[2]);
            if (coord) {
                moves.push({
                    x: coord.x,
                    y: coord.y,
                    color: color,
                    isPass: coord.isPass,
                    num: moveNum + 1
                });
                moveNum++;  // 脱先也算一着
            }
        }

        return moves;
    }

    /**
     * 从坐标字符串解析着法 (空格分隔)
     * @param {string} movesStr - 坐标字符串
     * @returns {Array} [{x, y, color, isPass}, ...]
     */
    function parseMovesString(movesStr) {
        const moves = [];
        if (!movesStr) return moves;

        const coords = movesStr.trim().split(/\s+/);
        coords.forEach((coord, i) => {
            if (coord.length === 2) {
                const parsed = sgfToCoord(coord);
                if (parsed) {
                    moves.push({
                        x: parsed.x,
                        y: parsed.y,
                        color: i % 2 === 0 ? 'black' : 'white',
                        isPass: parsed.isPass,
                        num: i + 1
                    });
                }
            }
        });

        return moves;
    }

    /**
     * 绘制缩略图 (19路坐标，截取右上角13路放大显示)
     * @param {HTMLCanvasElement} canvas - 目标 canvas
     * @param {Array} moves - 着法数组 (19路坐标)
     * @param {Object} options - 配置选项
     */
    function drawThumbnail(canvas, moves, options = {}) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const canvasSize = canvas.width;
        const displaySize = 13;  // 固定13路

        // 清空画布
        ctx.clearRect(0, 0, canvasSize, canvasSize);

        // 绘制棋盘背景
        const bgColor = options.bgColor || '#DCB35C';
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvasSize, canvasSize);

        // 计算截取区域 (19路坐标)
        // 13路: x从6-18, y从0-12
        const startX = 19 - displaySize;  // 6
        const startY = 0;

        // 网格参数：基于displaySize填满整个canvas
        const padding = canvasSize * 0.05;
        const gridSize = (canvasSize - padding * 2) / (displaySize - 1);

        // 绘制网格线
        ctx.strokeStyle = '#8B7355';
        ctx.lineWidth = 1;

        for (let i = 0; i < displaySize; i++) {
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

        // 绘制星位点
        ctx.fillStyle = '#333';
        // 19路星位在右上角13路范围内的: (15,3), (9,3)
        const stars19 = [[15, 3], [9, 3]];
        stars19.forEach(([sx, sy]) => {
            if (sx >= startX && sy >= startY && sy < displaySize) {
                const localX = sx - startX;
                const localY = sy - startY;
                ctx.beginPath();
                ctx.arc(padding + localX * gridSize, padding + localY * gridSize, Math.max(2, gridSize * 0.1), 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // 绘制棋子
        const stoneRadius = gridSize * 0.45;
        moves.forEach(move => {
            // 跳过脱先（pass不着子在棋盘上）
            if (move.isPass) return;
            
            // 检查是否在显示范围内
            if (move.x >= startX && move.x < 19 && move.y >= startY && move.y < displaySize) {
                // 转换为局部坐标
                const localX = move.x - startX;
                const localY = move.y - startY;

                const cx = padding + localX * gridSize;
                const cy = padding + localY * gridSize;

                ctx.beginPath();
                ctx.arc(cx, cy, stoneRadius, 0, Math.PI * 2);

                const gradient = ctx.createRadialGradient(
                    cx - stoneRadius * 0.3, cy - stoneRadius * 0.3, stoneRadius * 0.1,
                    cx, cy, stoneRadius
                );

                if (move.color === 'black') {
                    gradient.addColorStop(0, '#555');
                    gradient.addColorStop(1, '#000');
                } else {
                    gradient.addColorStop(0, '#fff');
                    gradient.addColorStop(1, '#bbb');
                }

                ctx.fillStyle = gradient;
                ctx.fill();
                ctx.strokeStyle = move.color === 'black' ? '#333' : '#999';
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        });
    }

    /**
     * 批量渲染页面上的缩略图
     * @param {string} selector - canvas 选择器
     */
    function renderAll(selector = 'canvas.joseki-thumbnail') {
        const canvases = document.querySelectorAll(selector);
        console.log('[BoardThumbnail] renderAll called, found', canvases.length, 'canvases');
        canvases.forEach((canvas, i) => {
            const movesData = canvas.dataset.moves || canvas.dataset.sgf;
            const prefixLen = parseInt(canvas.dataset.prefixLen) || 0;
            console.log('[BoardThumbnail] canvas', i, 'movesData:', movesData ? movesData.substring(0, 30) + '...' : 'empty', 'prefixLen:', prefixLen);
            if (movesData) {
                render(canvas, movesData, { prefixLen: prefixLen });
            }
        });
    }

    /**
     * 从数据绘制缩略图 (自动解析格式)
     * @param {HTMLCanvasElement} canvas - 目标 canvas
     * @param {string|Array} data - SGF 字符串、坐标字符串或着法数组
     * @param {Object} options - 配置选项
     */
    function render(canvas, data, options = {}) {
        let moves = [];

        if (Array.isArray(data)) {
            moves = data;
        } else if (typeof data === 'string') {
            if (data.includes(';') && (data.includes('B[') || data.includes('W['))) {
                moves = parseSgfMoves(data);
            } else if (data.trim().length > 0) {
                moves = parseMovesString(data);
            }
        }

        // 根据 prefixLen 截断着法
        const prefixLen = options.prefixLen || 0;
        if (prefixLen > 0 && moves.length > prefixLen) {
            moves = moves.slice(0, prefixLen);
        }

        drawThumbnail(canvas, moves, options);
    }

    // 导出 API
    global.BoardThumbnail = {
        render: render,
        renderAll: renderAll,
        parseSgfMoves: parseSgfMoves,
        parseMovesString: parseMovesString
    };

})(window);