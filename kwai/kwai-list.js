// ==UserScript==
// @name         导出播放列表
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  导出播放列表
// @author       CDM
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @require      https://cdn.bootcdn.net/ajax/libs/jquery/3.6.0/jquery.min.js 
// ==/UserScript==

(function($) {
  'use strict';

  // 全局状态变量
  const videoData = []; 
  let isFetching = false;
  let pageCursor = '';
  let hasMore = true;
  const PAGE_SIZE = 20; 
  const videoMap = new Map();


  // 初始化页面结构
  function initUI() {
    GM_addStyle(`
      #load-all,#copy-json {
        position: fixed; 
        padding: 10px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        z-index: 9999;
      }
      #copy-json {
        left: 20px;
        bottom: 20px;
      }
      #load-all {
        right: 20px;
        bottom: 20px;
      }
      .list-content {
        margin-bottom: 20px;
        padding: 10px;
      }
      .video-item {
        padding: 10px;
        margin: 5px 0;
        background: #f5f5f5;
        border-radius: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #loading-overlay {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 10px;
        background: rgba(0,0,0,0.5);
        z-index: 9998;
      }
      
      .morning a{
        color: green;
      }
    `);
    
    $('body').html('')
    
    $('body').prepend(`
      <button id="load-all">加载全部</button>
      <button id="copy-json">复制数据</button>
      <div class="list-section">
        <div class="list-content"></div>
        <div id="loading-overlay">
          <div class="loader"></div>
          <div class="loading-text">正在加载中...</div>
        </div>
      </div>
    `);
  }

  // 事件监听
  function setupEventListeners() { 
    $('#load-all').on('click', async function() { 
      
      try {
        isFetching = true; 
        
        $('#loading-overlay').fadeIn(200);

        while (hasMore) {
          await loadNextPage();
      
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        showMessage(`所有数据(${videoData.length}条记录)加载完成`, 'success');
      } catch (error) {
        showMessage(`加载失败: ${error.message}`);
      } finally {
        isFetching = false; 
        
        $('#loading-overlay').fadeOut(300);
      }
    });

     // 在 setupEventListeners 函数中修正事件绑定
    $('#copy-json').on('click', function() {
        if (videoData.length === 0) {
            showMessage('没有可复制的数据', 'error');
            return;
        }
    
        try { 
            // 生成格式化的JSON字符串
            const jsonString = JSON.stringify(videoData, null, 4);
            
            // 复制到剪贴板
            navigator.clipboard.writeText(jsonString)
                .then(() => showMessage('数据已复制到剪贴板', 'success'))
                .catch(err => showMessage(`复制失败: ${err.message}`));
        } catch (error) {
            showMessage(`生成JSON失败: ${error.message}`);
        }
    });

  }
  
  
  
  // 添加日期格式化函数
  function formatDate(timestamp) {
      const date = new Date(timestamp + 8 * 3600 * 1000);
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = date.getUTCDate().toString().padStart(2, '0');
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      const seconds = date.getUTCSeconds().toString().padStart(2, '0');
      return `${year}${month}${day} ${hours}:${minutes}:${seconds}`;
  }
  
  function getPreviousDayYMD(timestamp) {
      const date = new Date(timestamp + 8 * 3600 * 1000); // 处理时区偏移（东八区）
      const hours = date.getUTCHours();
      
      // 如果是0点到6点，则减去一天
      if (hours >= 0 && hours < 6) {
          date.setUTCDate(date.getUTCDate() - 1);
      }
      
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = date.getUTCDate().toString().padStart(2, '0');
      return `${year}${month}${day}`;
  }
  
  function isEarlyMorning(time) {
    const date = new Date(time); // 将时间字符串转换为 Date 对象
    const hours = date.getHours(); // 获取小时数
    return hours >= 0 && hours < 6; // 返回是否为凌晨
  }

  // 核心数据加载逻辑
  async function loadNextPage() {
    

    try {
      const url = `https://live.kuaishou.com/live_api/playback/list?count=${PAGE_SIZE}&principalId=dabingdekuaishou&cursor=${pageCursor}`
      
      const { data } = await fetchAPI(url);

      if (data?.list?.length) {
        const tempResults = await processVideoItems(data.list);
        renderVideoItems(tempResults);
        
        tempResults.forEach(video => {
          videoMap.set(video.id, video);
        }); 
        
        pageCursor = data.pcursor || '';
        hasMore = data.pcursor!='no_more';
        
        $('#loading-overlay .loading-text').html(`已加载(${videoData.length})条数据`);
        
        console.log(data)
      } else {
        hasMore = false;
      }
    } finally {
      
    }
  }


    async function processVideoItems(items) {
      // 创建临时存储数组
      const tempResults = [];

      // 使用 Promise.all 处理所有异步请求
      await Promise.all(items.map(async (item) => {
        try {
          const detail = await fetchVideoDetail(item.id);
          if (detail?.currentWork) {
            // 将结果暂存到临时数组
            tempResults.push({
              id: item.id,
              timestamp: item.createTime,
              date:formatDate(item.createTime),
              ymd: getPreviousDayYMD(item.createTime),
              urls: extractVideoUrls(detail.currentWork),
              hasSrt: false,
              dsource: 'kwai',
              isEarlyMorning: isEarlyMorning(item.createTime)
            });
          }
        } catch(error) {
          console.warn('视频详情获取失败:', error);
        }
      }));

      // 过滤无效数据后排序(时间戳从大到小)
      const validResults = tempResults.filter(item => !!item.timestamp);
      const sortedResults = validResults.sort((a,
        b) => b.timestamp - a.timestamp);

      // 将排序后的结果存入 videoData
      videoData.push(...sortedResults);

      // 对 videoData 整体去重(可选)
      const uniqueMap = new Map();
      videoData.forEach(item => uniqueMap.set(item.id,
        item));
      videoData.length = 0;
      videoData.push(...Array.from(uniqueMap.values()));
      return sortedResults
    }


    // 辅助函数
    async function fetchVideoDetail(videoId) {
      const url = `https://live.kuaishou.com/live_api/playback/detail?productId=${videoId}`
      console.log(url)
      const { data } = await fetchAPI(url);
      console.warn(data)
      return data;
    }

    function extractVideoUrls(workData) {
      return [
        workData.playUrl,
        ...Object.values(workData.playUrlV2 || {})
      ].filter(url => url?.trim());
    }

    function renderVideoItems(items) {
      const $content = $('.list-content');
      items.forEach((item, index) => {
        $content.append(createVideoItem(item, index)); // 将索引传递给createVideoItem
      });

    }
    
    const formatNumber = num => String(num).padStart(4, '0')
 
    let counter = 0;
    function createVideoItem(video, index) {
      counter = counter + 1
      return $(`
        <div class="video-item" data-id="${video.id}">
          <div class="video-date ${video.isEarlyMorning?'morning':''}">
            <a href="javascript:docopy('gdmp3 ${video.urls[0]} ${video.id}','命令');">【${formatNumber(counter)}】</a> - 
            <a href="javascript:docopyJSON('${video.id}','JSON');">JSON</a> - 
            <a href="javascript:docopy('${video.urls[0]}','链接');">${video.ymd}</a> - 
            <a href="javascript:docopy('${video.id}','ID');">${video.id}</a>
          </div>
        </div>
        `);
    }
 
    window.docopy = function(txt,tips) {
        try { 
            // 复制到
            navigator.clipboard.writeText(txt)
                .then(() => showMessage(tips+'已复制到剪贴板:'+txt, 'success'))
                .catch(err => showMessage(tips+`复制失败: ${err.message}`));
        } catch (error) {
            showMessage(tips+`复制失败: ${error.message}`);
        }
    }
    
    window.docopyJSON = function(id,tips) {
        try { 
            // 复制到
            const v = videoMap.get(id)
            const txt = JSON.stringify(v)
            navigator.clipboard.writeText(txt)
                .then(() => showMessage(tips+'已复制到剪贴板:'+txt, 'success'))
                .catch(err => showMessage(tips+`复制失败: ${err.message}`));
        } catch (error) {
            showMessage(tips+`复制失败: ${error.message}`);
        }
    }
     

    function formatTime(timestamp) {
      return new Date(timestamp + 8 * 3600 * 1000)
      .toISOString()
      .replace('T', ' ')
      .substring(0, 16);
      // .replace(/-/g, '/');
    }
 
    async function fetchAPI(url) {
      //console.log(url)
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest( {
          method: 'GET',
          url: url,
          headers: {
            'Referer': location.href,
            'Origin': 'https://live.kuaishou.com'
          },
          onload: resp => {
            try {
              resolve(JSON.parse(resp.responseText));
            } catch(e) {
              reject(new Error('响应解析失败'));
            }
          },
          onerror: error => reject(error)
        });
      });
    }

    function showMessage(text, type = 'error') {
      // 删除所有旧弹窗
      $('.global-message').remove();
      const $msg = $(`
          <div class="global-message" style="position:fixed; bottom:90px;
              padding:8px;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.15);
              background: ${type === 'error' ? '#ffebee' : '#e8f5e9'};
              color: ${type === 'error' ? '#c62828' : '#2e7d32'};
              z-index: 9999;
              width: 100%;
              transition: all 0.3s ease;
              left:0;
              transform: translateY(-20px) translateX(50%);
              opacity: 0;">
              <div class="msg-close"
                  style="position:absolute;
                  top:5px;
                  right:20px;
                  width:50px;
                  height:50px;
                  line-height:50px;
                  text-align:center;
                  cursor:pointer;
                  color:#666;
                  border-radius:50%;
                  transition: all 0.2s ease;">
                  ×
              </div>
              ${text}
          </div>
      `);

      $('body').append($msg);

      // 动画入场
      setTimeout(() => {
          $msg.css({
              transform: 'translateY(0)',
              opacity: 1
          });
      }, 50);

      // 关闭按钮事件
      $msg.find('.msg-close').on('click', function() {
          $msg.remove();
      });
    }

  // 初始化
  $(async () => {
    try {
      initUI();
      setupEventListeners();
    } catch(error) {
      showMessage('初始化失败: ' + error.message);
    }
  });

})(jQuery);
