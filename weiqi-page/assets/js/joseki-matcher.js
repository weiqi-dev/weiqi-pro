/**
 * 定式匹配器
 * 用于将着法串与定式库进行匹配
 * 支持按需加载子树，避免一次性加载整棵树
 */

class JosekiMatcher {
    /**
     * 构造函数
     * @param {string} dataPath - 定式库数据路径
     */
    constructor(dataPath = '/assets/data/joseki') {
        this.dataPath = dataPath;
        this.trieRoot = null;
        this.currentNode = null;
        this.currentPath = [];
        
        // 检测环境
        this.isNode = typeof window === 'undefined' && typeof require !== 'undefined';
        
        // Node.js 环境导入依赖
        if (this.isNode) {
            this.fs = require('fs');
            this.zlib = require('zlib');
            this.path = require('path');
        }
    }

    /**
     * 加载 gzip 压缩的 JSON 文件
     * @param {string} url - 文件 URL 或路径
     * @returns {Promise<Object>} 解压后的 JSON 对象
     */
    async loadGzipJson(url) {
        try {
            if (this.isNode) {
                // Node.js 环境：使用 fs 和 zlib
                const compressed = this.fs.readFileSync(url);
                const decompressed = this.zlib.gunzipSync(compressed);
                const jsonStr = decompressed.toString('utf-8');
                return JSON.parse(jsonStr);
            } else {
                // 浏览器环境：使用 fetch 和 pako
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const compressed = await response.arrayBuffer();
                const decompressed = pako.ungzip(compressed, { to: 'string' });
                return JSON.parse(decompressed);
            }
        } catch (error) {
            console.error(`[JosekiMatcher] 加载失败: ${url}`, error);
            throw error;
        }
    }

    /**
     * 加载索引（trie 树根节点）
     */
    async loadIndex() {
        if (this.trieRoot) {
            return; // 已加载
        }

        try {
            this.trieRoot = await this.loadGzipJson(`${this.dataPath}/trie-index.json.gz`);
            this.currentNode = this.trieRoot;
            this.currentPath = [];
            console.log('[JosekiMatcher] 索引加载成功');
        } catch (error) {
            console.error('[JosekiMatcher] 索引加载失败:', error);
            throw error;
        }
    }

    /**
     * 加载子树并合并到节点
     * @param {Object} node - trie 树节点
     */
    async loadSubtree(node) {
        if (!node.subtree || node.children) {
            return; // 不是裁剪点或已加载
        }

        try {
            const subtree = await this.loadGzipJson(`${this.dataPath}/${node.subtree.file}`);
            
            // 合并子树的所有字段（覆盖同名字段）
            for (const key in subtree) {
                node[key] = subtree[key];
            }
            
            console.log(`[JosekiMatcher] 子树加载成功: ${node.subtree.file}`);
        } catch (error) {
            console.error(`[JosekiMatcher] 子树加载失败: ${node.subtree.file}`, error);
            throw error;
        }
    }

    /**
     * 匹配单个着法串
     * @param {Array} moves - SGF 坐标数组（如 ['pd', 'qc', 'qd']）
     * @returns {Promise<Object>} 匹配结果
     */
    async matchSequence(moves) {
        // 确保索引已加载
        await this.loadIndex();

        let node = this.trieRoot;
        const matchedPath = [];
        const validMatches = [];  // 记录所有有效的定式节点

        for (let i = 0; i < moves.length; i++) {
            const coord = moves[i];
            
            // 注意：不要跳过 pass (tt)，因为定式库中可能包含 tt
            // Python 的定式库中包含 tt，如 "pd tt nc tt ke"

            // 检查当前节点是否需要加载子树
            if (node.subtree && !node.children) {
                await this.loadSubtree(node);
            }

            // 检查是否有子节点
            if (!node.children) {
                // 无法继续匹配
                break;
            }

            // 查找下一个节点
            if (node.children[coord]) {
                node = node.children[coord];
                matchedPath.push(coord);
                
                // 检查这个节点是否为有效的定式节点（freq 非 0）
                if (node.freq && node.freq > 0) {
                    validMatches.push({
                        matched: [...matchedPath],
                        matchedCount: matchedPath.length,
                        totalCount: moves.length,
                        node: node,
                        complete: matchedPath.length === moves.length,
                        freq: node.freq,
                        moves: node.moves,
                        prob: node.prob,
                        heat: node.heat,
                        winrate_stats: node.winrate
                    });
                }
            } else {
                // 未找到匹配
                break;
            }
        }

        // 从所有有效定式节点中，选择匹配最长且频率最高的
        if (validMatches.length > 0) {
            validMatches.sort((a, b) => {
                // 首先按匹配长度降序
                if (b.matchedCount !== a.matchedCount) {
                    return b.matchedCount - a.matchedCount;
                }
                // 相同长度，按频率降序
                return b.freq - a.freq;
            });
            return validMatches[0];  // 返回最佳的匹配
        }

        // 没有有效的定式节点
        return {
            matched: matchedPath,
            matchedCount: matchedPath.length,
            totalCount: moves.length,
            node: node,
            complete: false
        };
    }

    /**
     * 批量匹配四个角的着法
     * @param {Object} corners - 四个角的着法 {tl: [...], tr: [...], bl: [...], br: [...]}
     * @returns {Promise<Object>} 匹配结果
     */
    async matchFourCorners(corners) {
        // 确保索引已加载
        await this.loadIndex();

        const results = {};

        for (const cornerKey of ['tl', 'tr', 'bl', 'br']) {
            const moves = corners[cornerKey];
            if (!moves || moves.length === 0) {
                results[cornerKey] = {
                    matched: [],
                    complete: false,
                    error: '无着法'
                };
                continue;
            }

            try {
                const result = await this.matchSequence(moves);
                results[cornerKey] = result;
            } catch (error) {
                results[cornerKey] = {
                    matched: [],
                    complete: false,
                    error: error.message
                };
            }
        }

        return results;
    }

    /**
     * 重置到根节点
     */
    reset() {
        this.currentNode = this.trieRoot;
        this.currentPath = [];
    }

    /**
     * 导出定式树 SGF
     * @param {Array} prefix - 前缀着法串
     * @param {Array} mainBranch - 主分支着法串
     * @param {number} limit - 限制变化分支数量
     * @returns {Promise<string>} SGF 字符串
     */
    async exportTree(prefix = [], mainBranch = null, limit = 100) {
        // 确保索引已加载
        await this.loadIndex();
        
        // 定位前缀
        let trie = this.trieRoot;
        for (const move of prefix) {
            if (!trie.children || !trie.children[move]) {
                return "(;C[前缀不存在])";
            }
            trie = trie.children[move];
            // 加载子树（如果需要）
            if (trie.subtree && !trie.children) {
                await this.loadSubtree(trie);
            }
        }
        
        // 收集包含前缀的定式终点
        const paths = await this._collectJosekiEndpoints(prefix);
        
        // 分离主分支和其他路径
        let otherPaths = [];
        let mainTuple = null;
        
        if (mainBranch) {
            const mainPathStr = mainBranch.join(',');
            // 检查主分支是否在定式库中
            const mainPath = paths.find(p => p.path.join(',') === mainPathStr);
            if (mainPath) {
                mainTuple = mainPath;
                // 其他路径排除主分支
                otherPaths = paths.filter(p => p.path.join(',') !== mainPathStr);
            } else {
                mainTuple = { path: mainBranch, freq: 0, ids: [] };
                otherPaths = paths;
            }
        } else {
            otherPaths = paths;
        }
        
        // 其他路径按频率排序，取 limit
        otherPaths.sort((a, b) => b.freq - a.freq);
        let selected = otherPaths.slice(0, limit);
        
        // 主分支放第一个（不占用 limit 名额）
        if (mainTuple) {
            selected.unshift(mainTuple);
        }
        
        // 构建树
        const tree = this._buildTreeFromPaths(selected, mainBranch);
        
        // 生成 SGF
        const prefixStr = prefix.length > 0 ? prefix.join(' ') : 'all';
        return this._treeToSgf(tree, 0, mainBranch, 0, prefixStr);
    }

    /**
     * 收集包含指定前缀的所有定式终点
     * @param {Array} prefix - 前缀着法串
     * @returns {Promise<Array>} [{path, freq, ids}, ...]
     */
    async _collectJosekiEndpoints(prefix) {
        const results = [];
        
        // 从前缀节点开始深度遍历
        let startNode = this.trieRoot;
        for (const move of prefix) {
            if (!startNode.children || !startNode.children[move]) {
                return results;
            }
            startNode = startNode.children[move];
            if (startNode.subtree && !startNode.children) {
                await this.loadSubtree(startNode);
            }
        }
        
        // 深度遍历收集所有定式终点
        const traverse = async (node, currentPath) => {
            // 如果节点有 freq，说明是定式终点
            if (node.freq && node.freq > 0) {
                results.push({
                    path: [...currentPath],
                    freq: node.freq,
                    ids: node.moves || []
                });
            }
            
            // 递归遍历子节点
            if (node.children) {
                for (const [move, childNode] of Object.entries(node.children)) {
                    // 加载子树（如果需要）
                    if (childNode.subtree && !childNode.children) {
                        await this.loadSubtree(childNode);
                    }
                    await traverse(childNode, [...currentPath, move]);
                }
            }
        };
        
        await traverse(startNode, [...prefix]);
        return results;
    }

    /**
     * 从路径列表构建树
     * @param {Array} paths - [{path, freq, ids}, ...]
     * @param {Array} mainBranch - 主分支路径
     * @returns {Object} 树结构
     */
    _buildTreeFromPaths(paths, mainBranch = null) {
        const root = {};
        const mainSet = new Set();
        
        if (mainBranch) {
            for (let i = 1; i <= mainBranch.length; i++) {
                mainSet.add(mainBranch.slice(0, i).join(','));
            }
        }
        
        for (const { path, freq, ids } of paths) {
            let node = root;
            for (let i = 0; i < path.length; i++) {
                const move = path[i];
                if (!node[move]) {
                    node[move] = { next: {}, freq: 0, ids: [], isMain: false };
                }
                
                // 标记是否为主分支
                const pathSoFar = path.slice(0, i + 1).join(',');
                if (mainSet.has(pathSoFar)) {
                    node[move].isMain = true;
                }
                
                // 只在终点设置 freq 和 ids
                if (i === path.length - 1) {
                    node[move].freq = freq;
                    node[move].ids = ids;
                }
                
                node = node[move].next;
            }
        }
        
        return root;
    }

    /**
     * 生成 SGF 字符串
     * @param {Object} tree - 树结构
     * @param {number} depth - 当前深度
     * @param {Array} mainBranch - 主分支路径
     * @param {number} mainDepth - 主分支深度
     * @param {string} prefixStr - 前缀字符串
     * @returns {string} SGF 字符串
     */
    _treeToSgf(tree, depth, mainBranch = null, mainDepth = 0, prefixStr = 'all') {
        const buildSgf = (tree, depth, mainBranch, mainDepth) => {
            if (!tree && !(mainBranch && mainDepth < mainBranch.length)) {
                return "";
            }
            
            // 确定当前节点
            let currentMove = null;
            let currentNode = null;
            
            if (mainBranch && mainDepth < mainBranch.length) {
                currentMove = mainBranch[mainDepth];
                if (tree && tree[currentMove]) {
                    currentNode = tree[currentMove];
                }
            }
            
            if (!currentNode && tree) {
                const items = Object.entries(tree).sort((a, b) => b[1].freq - a[1].freq);
                if (items.length > 0) {
                    [currentMove, currentNode] = items[0];
                }
            }
            
            if (!currentNode) {
                // 输出剩余主分支
                if (mainBranch && mainDepth < mainBranch.length) {
                    let parts = [];
                    for (let i = mainDepth; i < mainBranch.length; i++) {
                        const color = i % 2 === 0 ? 'B' : 'W';
                        parts.push(`;${color}[${mainBranch[i]}]`);
                    }
                    return parts.join('');
                }
                return "";
            }
            
            // 输出当前节点
            const color = depth % 2 === 0 ? 'B' : 'W';
            const freq = currentNode.freq || 0;
            const ids = currentNode.ids || [];
            
            let nodeSgf;
            if (ids.length > 0 && freq > 0) {
                nodeSgf = `;${color}[${currentMove}]C[出现次数:${freq}]`;
            } else {
                nodeSgf = `;${color}[${currentMove}]`;
            }
            
            // 获取子树
            const nextTree = currentNode.next || {};
            
            // 确定主分支下一手
            let mainNext = null;
            const hasMainRemaining = mainBranch && mainDepth + 1 < mainBranch.length;
            if (hasMainRemaining) {
                mainNext = mainBranch[mainDepth + 1];
            }
            
            // 收集子节点
            const allChildren = [];
            for (const [move, node] of Object.entries(nextTree)) {
                const isMain = move === mainNext;
                allChildren.push([move, node, isMain]);
            }
            
            // 排序：主分支优先，然后按频率
            allChildren.sort((a, b) => {
                if (a[2] !== b[2]) return b[2] - a[2];
                return b[1].freq - a[1].freq;
            });
            
            // 生成子节点 SGF
            const childParts = [];
            const singleMainChild = allChildren.length === 1 && allChildren[0][2];
            
            for (const [childMove, childNode, isMain] of allChildren) {
                const branchColor = (depth + 1) % 2 === 0 ? 'B' : 'W';
                const childFreq = childNode.freq || 0;
                const childIds = childNode.ids || [];
                
                // 递归生成分支的后续
                let branchCont;
                if (isMain && hasMainRemaining) {
                    branchCont = buildSgf(childNode.next || {}, depth + 2, mainBranch, mainDepth + 2);
                } else {
                    branchCont = buildSgf(childNode.next || {}, depth + 2, null, 0);
                }
                
                if (singleMainChild) {
                    // 只有一个主分支子节点，直接延续不包裹括号
                    if (childIds.length > 0 && childFreq > 0) {
                        childParts.push(`;${branchColor}[${childMove}]C[出现次数:${childFreq}]${branchCont}`);
                    } else {
                        childParts.push(`;${branchColor}[${childMove}]${branchCont}`);
                    }
                } else {
                    // 多个子节点，用括号包裹
                    let branchStart;
                    if (childIds.length > 0 && childFreq > 0) {
                        branchStart = `(;${branchColor}[${childMove}]C[出现次数:${childFreq}]`;
                    } else {
                        branchStart = `(;${branchColor}[${childMove}]`;
                    }
                    childParts.push(`${branchStart}${branchCont})`);
                }
            }
            
            // 如果子树为空但主分支还有剩余
            if (allChildren.length === 0 && hasMainRemaining) {
                for (let i = mainDepth + 1; i < mainBranch.length; i++) {
                    const color = i % 2 === 0 ? 'B' : 'W';
                    childParts.push(`;${color}[${mainBranch[i]}]`);
                }
            }
            
            return nodeSgf + childParts.join('');
        };
        
        // 生成完整 SGF
        const body = buildSgf(tree, depth, mainBranch, mainDepth);
        return `(;FF[4]AP[WeiqiJoseki:1.0]C[定式树: ${prefixStr}]CA[UTF-8]GM[1]SZ[19]${body})`;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = JosekiMatcher;
}
