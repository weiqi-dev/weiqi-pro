/**
 * joseki-loader.js - 围棋定式库加载公共库
 * 
 * 功能：
 * 1. 加载进度管理（显示/隐藏遮罩、进度更新）
 * 2. gzip 文件下载与解压（带进度）
 * 3. 定式索引加载
 * 4. 子树按需加载
 * 5. 题库加载
 * 
 * 使用示例：
 *   const loader = new JosekiLoader('/assets/data/joseki');
 *   await loader.loadIndex();
 *   await loader.loadSubtree(node);
 *   await loader.loadQuizData('easy');
 * 
 * @version 20260510
 */

(function(global) {
    'use strict';

    // ========== 工具函数 ==========

    /**
     * 格式化文件大小
     */
    function formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '-';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    /**
     * 让出主线程，允许 UI 更新
     */
    function yieldToMain() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * 难度名称映射
     */
    function getDifficultyName(diff) {
        const names = { easy: '初级', medium: '中级', hard: '高级' };
        return names[diff] || diff;
    }

    // ========== 加载遮罩管理 ==========

    class LoadingOverlay {
        constructor() {
            this.element = null;
            this.elements = {};
            this._createDOM();
        }

        _createDOM() {
            // 创建遮罩层 DOM
            const overlay = document.createElement('div');
            overlay.id = 'josekiLoadingOverlay';
            overlay.className = 'joseki-loading-overlay';
            overlay.innerHTML = `
                <div class="joseki-loading-modal">
                    <div class="joseki-loading-icon">◠</div>
                    <div class="joseki-loading-title" id="josekiLoadingTitle">加载中...</div>
                    
                    <div class="joseki-loading-task" id="josekiLoadingTask">正在加载</div>
                    
                    <div class="joseki-loading-progress">
                        <div class="joseki-loading-progress-bar" id="josekiLoadingProgressBar"></div>
                    </div>
                    <div class="joseki-loading-percent" id="josekiLoadingPercent">0%</div>
                    
                    <div class="joseki-loading-details">
                        <div class="joseki-loading-detail-row">
                            <span>当前文件:</span>
                            <span id="josekiLoadingFileName">-</span>
                        </div>
                        <div class="joseki-loading-detail-row">
                            <span>文件大小:</span>
                            <span id="josekiLoadingFileSize">-</span>
                        </div>
                        <div class="joseki-loading-detail-row">
                            <span>已下载:</span>
                            <span id="josekiLoadingLoadedBytes">-</span>
                        </div>
                    </div>
                    
                    <div class="joseki-loading-tasks" id="josekiLoadingTasksInfo" style="display:none;">
                        <span id="josekiLoadingTasksCount">(0/0)</span>
                    </div>
                    
                    <button class="joseki-loading-cancel-btn" id="josekiLoadingCancelBtn">取消加载</button>
                </div>
            `;

            // 添加样式
            const style = document.createElement('style');
            style.textContent = `
                .joseki-loading-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    backdrop-filter: blur(4px);
                }
                .joseki-loading-overlay.active {
                    display: flex;
                }
                .joseki-loading-modal {
                    background: white;
                    border-radius: 16px;
                    padding: 24px 32px;
                    min-width: 300px;
                    max-width: 90%;
                    text-align: center;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                }
                .joseki-loading-icon {
                    font-size: 32px;
                    color: #667eea;
                    animation: joseki-spin 1s linear infinite;
                    margin-bottom: 12px;
                }
                @keyframes joseki-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .joseki-loading-title {
                    font-size: 18px;
                    font-weight: 600;
                    color: #333;
                    margin-bottom: 8px;
                }
                .joseki-loading-task {
                    font-size: 14px;
                    color: #666;
                    margin-bottom: 16px;
                }
                .joseki-loading-progress {
                    height: 8px;
                    background: #e0e0e0;
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 8px;
                }
                .joseki-loading-progress-bar {
                    height: 100%;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    width: 0%;
                    transition: width 0.2s ease;
                }
                .joseki-loading-percent {
                    font-size: 24px;
                    font-weight: bold;
                    color: #667eea;
                    margin-bottom: 16px;
                }
                .joseki-loading-details {
                    background: #f5f5f5;
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 16px;
                    font-size: 13px;
                    color: #666;
                    text-align: left;
                }
                .joseki-loading-detail-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 4px;
                }
                .joseki-loading-detail-row:last-child {
                    margin-bottom: 0;
                }
                .joseki-loading-tasks {
                    font-size: 13px;
                    color: #999;
                    margin-bottom: 12px;
                }
                .joseki-loading-cancel-btn {
                    background: #f5f5f5;
                    border: none;
                    padding: 10px 24px;
                    border-radius: 8px;
                    font-size: 14px;
                    color: #666;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .joseki-loading-cancel-btn:hover {
                    background: #e0e0e0;
                }
            `;

            document.head.appendChild(style);
            document.body.appendChild(overlay);

            this.element = overlay;
            this.elements = {
                title: overlay.querySelector('#josekiLoadingTitle'),
                task: overlay.querySelector('#josekiLoadingTask'),
                progressBar: overlay.querySelector('#josekiLoadingProgressBar'),
                percent: overlay.querySelector('#josekiLoadingPercent'),
                fileName: overlay.querySelector('#josekiLoadingFileName'),
                fileSize: overlay.querySelector('#josekiLoadingFileSize'),
                loadedBytes: overlay.querySelector('#josekiLoadingLoadedBytes'),
                tasksInfo: overlay.querySelector('#josekiLoadingTasksInfo'),
                tasksCount: overlay.querySelector('#josekiLoadingTasksCount'),
                cancelBtn: overlay.querySelector('#josekiLoadingCancelBtn'),
            };
        }

        show() {
            this.element.classList.add('active');
        }

        hide() {
            this.element.classList.remove('active');
        }

        update(state) {
            const { 
                taskName, 
                status,
                totalTasks, 
                completedTasks, 
                currentFile, 
                currentFileSize, 
                totalBytes, 
                loadedBytes 
            } = state;

            // 更新标题
            if (taskName) {
                this.elements.title.textContent = taskName;
            }

            // 更新状态
            if (status) {
                this.elements.task.textContent = status;
            }

            // 更新文件信息
            if (currentFile) {
                this.elements.fileName.textContent = currentFile;
            }
            this.elements.fileSize.textContent = formatFileSize(currentFileSize);
            this.elements.loadedBytes.textContent = formatFileSize(loadedBytes);

            // 更新进度条
            let percent = 0;
            if (totalBytes > 0) {
                percent = Math.round((loadedBytes / totalBytes) * 100);
            }
            this.elements.progressBar.style.width = percent + '%';
            this.elements.percent.textContent = percent + '%';

            // 更新任务计数
            if (totalTasks > 1) {
                this.elements.tasksInfo.style.display = 'block';
                this.elements.tasksCount.textContent = `(${completedTasks}/${totalTasks})`;
            } else {
                this.elements.tasksInfo.style.display = 'none';
            }
        }

        onCancel(callback) {
            this.elements.cancelBtn.onclick = callback;
        }
    }

    // ========== 加载进度管理器 ==========

    class LoadingManager {
        constructor(overlay) {
            this.overlay = overlay;
            this.state = this._getInitialState();
            this.abortController = null;
        }

        _getInitialState() {
            return {
                taskName: '',
                status: '正在加载',
                totalTasks: 1,
                completedTasks: 0,
                currentFile: '',
                currentFileSize: 0,
                totalBytes: 0,
                loadedBytes: 0,
            };
        }

        start(taskName, totalTasks = 1, silent = false) {
            this.state = {
                ...this._getInitialState(),
                taskName,
                totalTasks,
            };
            this.abortController = new AbortController();
            
            // 只有非静默模式才显示遮罩
            if (!silent) {
                this.overlay.show();
                this._update();
                
                // 绑定取消事件
                this.overlay.onCancel(() => this.abort());
            }
        }

        startTask(fileName, fileSize = 0) {
            this.state.currentFile = fileName;
            this.state.currentFileSize = fileSize;
            this.state.totalBytes = fileSize;
            this.state.loadedBytes = 0;
            this._update();
        }

        updateProgress(loadedBytes, totalBytes = null) {
            this.state.loadedBytes = loadedBytes;
            if (totalBytes !== null) {
                this.state.totalBytes = totalBytes;
            }
            this._update();
        }

        updateStatus(status) {
            this.state.status = status;
            this._update();
        }

        completeTask() {
            this.state.completedTasks++;
            this._update();
        }

        finish() {
            this.state = this._getInitialState();
            this.abortController = null;
            this.overlay.hide();
        }

        abort() {
            if (this.abortController) {
                this.abortController.abort();
            }
            this.finish();
        }

        getSignal() {
            return this.abortController ? this.abortController.signal : null;
        }

        _update() {
            this.overlay.update(this.state);
        }
    }

    // ========== 定式加载器 ==========

    class JosekiLoader {
        /**
         * @param {string} dataPath - 数据文件路径，如 '/assets/data/joseki'
         */
        constructor(dataPath) {
            this.dataPath = dataPath;
            this.overlay = new LoadingOverlay();
            this.manager = new LoadingManager(this.overlay);

            // 缓存数据
            this.trieRoot = null;
            this.quizData = { easy: null, medium: null, hard: null };
            this.loadedSubtrees = new Set(); // 已加载的子树文件
            this.subtreeCache = new Map();   // 子树数据缓存（用于预加载后合并）

            // 加载状态
            this.isLoading = false;
        }

        /**
         * 加载 gzip 压缩的 JSON 文件（带进度）
         */
        async loadGzipJson(url) {
            const signal = this.manager.getSignal();
            const fileName = url.split('/').pop();

            // 1. 发起请求
            this.manager.updateStatus('正在下载...');
            const response = await fetch(url, { signal });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // 2. 获取文件大小
            const contentLength = response.headers.get('content-length');
            const fileSize = contentLength ? parseInt(contentLength, 10) : 0;
            this.manager.startTask(fileName, fileSize);

            // 3. 下载文件（带进度）
            const reader = response.body.getReader();
            const chunks = [];
            let loadedBytes = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                loadedBytes += value.length;
                this.manager.updateProgress(loadedBytes, fileSize);
            }

            // 4. 合并 chunks
            const compressed = new Uint8Array(loadedBytes);
            let offset = 0;
            for (const chunk of chunks) {
                compressed.set(chunk, offset);
                offset += chunk.length;
            }

            // 5. 解压
            await yieldToMain();
            this.manager.updateStatus('正在解压数据...');
            const decompressed = pako.ungzip(compressed, { to: 'string' });

            // 6. 解析 JSON
            await yieldToMain();
            this.manager.updateStatus('正在解析数据...');
            const data = JSON.parse(decompressed);

            return data;
        }

        /**
         * 加载定式索引
         * @param {Object} options - 选项
         * @param {boolean} options.showProgress - 是否显示进度，默认 false
         */
        async loadIndex(options = {}) {
            const { showProgress = false } = options;
            
            if (this.trieRoot) {
                return this.trieRoot;
            }

            this.isLoading = true;
            this.manager.start('加载定式索引', 1, !showProgress);

            try {
                const url = `${this.dataPath}/trie-index.json.gz`;
                this.trieRoot = await this.loadGzipJson(url);
                this.manager.completeTask();
                return this.trieRoot;
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.log('[JosekiLoader] 加载已取消');
                } else {
                    console.error('[JosekiLoader] 索引加载失败:', e);
                }
                throw e;
            } finally {
                this.isLoading = false;
                this.manager.finish();
            }
        }

        /**
         * 加载子树（按需加载）
         * @param {Object} node - trie 节点，需包含 subtree.file 字段
         * @param {Object} options - 选项
         * @param {boolean} options.showProgress - 是否显示进度，默认 false
         * @returns {Promise<Object>} - 子树数据
         */
        async loadSubtree(node, options = {}) {
            const { showProgress = false } = options;
            
            if (!node || !node.subtree || !node.subtree.file) {
                return null;
            }

            const file = node.subtree.file;
            
            // 已加载过且数据已合并
            if (this.loadedSubtrees.has(file) && node.children) {
                return node;
            }
            
            // 已加载过但数据未合并，从缓存中获取并合并
            if (this.loadedSubtrees.has(file) && !node.children) {
                const cachedSubtree = this.subtreeCache.get(file);
                if (cachedSubtree) {
                    // 从缓存中合并数据
                    node.children = cachedSubtree.children;
                    node.heat = cachedSubtree.heat;
                    if (cachedSubtree.freq) {
                        node.freq = cachedSubtree.freq;
                        node.moves = cachedSubtree.moves;
                        node.prob = cachedSubtree.prob;
                    }
                    return cachedSubtree;
                }
            }
            
            // 未加载过，需要加载

            this.isLoading = true;
            this.manager.start('加载定式分支', 1, !showProgress);

            try {
                const url = `${this.dataPath}/${file}`;
                const subtree = await this.loadGzipJson(url);
                
                // 合并到节点
                node.children = subtree.children;
                node.heat = subtree.heat;
                if (subtree.freq) {
                    node.freq = subtree.freq;
                    node.moves = subtree.moves;
                    node.prob = subtree.prob;
                }

                this.loadedSubtrees.add(file);
                this.manager.completeTask();
                
                return subtree;
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.log('[JosekiLoader] 子树加载已取消');
                } else {
                    console.error('[JosekiLoader] 子树加载失败:', e);
                }
                throw e;
            } finally {
                this.isLoading = false;
                this.manager.finish();
            }
        }

        /**
         * 批量加载子树
         * @param {Array<string>} files - 子树文件名列表
         * @param {Object} options - 选项
         * @param {boolean} options.showProgress - 是否显示进度，默认 true
         * @param {Function} onProgress - 进度回调 (completed, total)
         */
        async loadSubtrees(files, options = {}, onProgress = null) {
            // 兼容旧的调用方式：loadSubtrees(files, onProgress)
            if (typeof options === 'function') {
                onProgress = options;
                options = {};
            }
            const { showProgress = true } = options;
            
            if (!files || files.length === 0) return;

            // 过滤已加载的
            const toLoad = files.filter(f => !this.loadedSubtrees.has(f));
            if (toLoad.length === 0) return;

            this.isLoading = true;
            this.manager.start('预加载定式分支', toLoad.length, !showProgress);

            const results = [];
            let completed = 0;

            try {
                for (const file of toLoad) {
                    const url = `${this.dataPath}/${file}`;
                    const subtree = await this.loadGzipJson(url);
                    
                    this.loadedSubtrees.add(file);
                    this.subtreeCache.set(file, subtree);  // 存储到缓存
                    results.push({ file, subtree });
                    
                    completed++;
                    this.manager.completeTask();
                    
                    if (onProgress) {
                        onProgress(completed, toLoad.length);
                    }
                }

                return results;
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.log('[JosekiLoader] 批量加载已取消');
                } else {
                    console.error('[JosekiLoader] 批量加载失败:', e);
                }
                throw e;
            } finally {
                this.isLoading = false;
                this.manager.finish();
            }
        }

        /**
         * 加载题库数据
         * @param {string} difficulty - 难度: 'easy', 'medium', 'hard'
         * @returns {Promise<Array>} - 题目列表
         */
        async loadQuizData(difficulty) {
            if (this.quizData[difficulty]) {
                return this.quizData[difficulty];
            }

            this.isLoading = true;
            this.manager.start(`加载${getDifficultyName(difficulty)}题库`, 1);

            try {
                const url = `${this.dataPath}/quiz-${difficulty}.json.gz`;
                const data = await this.loadGzipJson(url);
                
                this.quizData[difficulty] = data.leaves || [];
                this.manager.completeTask();
                
                return this.quizData[difficulty];
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.log('[JosekiLoader] 题库加载已取消');
                } else {
                    console.error('[JosekiLoader] 题库加载失败:', e);
                }
                throw e;
            } finally {
                this.isLoading = false;
                this.manager.finish();
            }
        }

        /**
         * 预加载所有难度题库
         */
        async loadAllQuizData(onProgress = null) {
            const difficulties = ['easy', 'medium', 'hard'];
            const toLoad = difficulties.filter(d => !this.quizData[d]);
            
            if (toLoad.length === 0) return this.quizData;

            this.isLoading = true;
            this.manager.start('加载题库', toLoad.length);

            let completed = 0;

            try {
                for (const diff of toLoad) {
                    const url = `${this.dataPath}/quiz-${diff}.json.gz`;
                    const data = await this.loadGzipJson(url);
                    
                    this.quizData[diff] = data.leaves || [];
                    completed++;
                    this.manager.completeTask();
                    
                    if (onProgress) {
                        onProgress(completed, toLoad.length);
                    }
                }

                return this.quizData;
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.log('[JosekiLoader] 题库加载已取消');
                } else {
                    console.error('[JosekiLoader] 题库加载失败:', e);
                }
                throw e;
            } finally {
                this.isLoading = false;
                this.manager.finish();
            }
        }

        /**
         * 取消当前加载
         */
        abort() {
            this.manager.abort();
        }

        /**
         * 检查是否正在加载
         */
        isLoadingData() {
            return this.isLoading;
        }

        /**
         * 获取已加载的索引
         */
        getIndex() {
            return this.trieRoot;
        }

        /**
         * 获取已加载的题库
         */
        getQuizData(difficulty) {
            return this.quizData[difficulty];
        }

        /**
         * 检查子树是否已加载
         */
        isSubtreeLoaded(file) {
            return this.loadedSubtrees.has(file);
        }

        /**
         * 清除缓存
         */
        clearCache() {
            this.trieRoot = null;
            this.quizData = { easy: null, medium: null, hard: null };
            this.loadedSubtrees.clear();
        }
    }

    // ========== 导出 ==========

    global.JosekiLoader = JosekiLoader;
    global.formatFileSize = formatFileSize;
    global.getDifficultyName = getDifficultyName;

})(window);
