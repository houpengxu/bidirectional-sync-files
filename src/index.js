#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fse = require('fs-extra');
const chokidar = require('chokidar');

let config = null
const customPath = process.argv[2]
const userHomeConfig = os.homedir() + '/.bidirectional-sync-files.json';
// 自定义路径
if (customPath && fse.pathExistsSync(customPath)) {
  config = require(customPath)
} else if (fse.pathExistsSync(userHomeConfig)) {
  // 用户主目录路径
  config = require(userHomeConfig)
} else {
  // 程序运行的相对路径
  console.log('请在用户目录设置.bidirectional-sync-files.json')
  config = require('./config.json')
}

// 同步中的文件列表
const syncFileList = new Set()
// 锁定同步中的文件时长(毫秒)
const lockSyncTime = 1000
// 循环检测启动程序后第一次源路径的文件或文件夹变化执行完毕间隔(毫秒)
const intervalTime = 1000 * 5
// 定时同步时间间隔(毫秒)
const intervalSyncTime = 1000 * 60 * 60

init();

// 入口
function init() {
  // 根据相对路径获取出绝对路径
  config.syncs = config.syncs.map(item => {
    if (item.from.startsWith('../') || item.from.startsWith('./')) {
      item.from = path.resolve(item.from)
    }
    if (item.to.startsWith('../') || item.to.startsWith('./')) {
      item.to = path.resolve(item.to)
    }
    return item
  })
  log(JSON.stringify(config.syncs))
  start()
}


// 开始
function start() {
  log('start')
  // 监听源路径的文件或文件夹变化
  for (const item of config.syncs) {
    const { from, to, ignored } = item;
    chokidar.watch(from, {
      ignored: ignored
    }).on('all', async (event, path) => {
      log(`watch: file ${path} has been ${event}.`);
      await sync(from, to, ignored);
    });
  }

  // 监听目标路径的文件或文件夹变化，需要等源路径的文件或文件夹变化执行结束
  const interval = setInterval(() => {
    for (const item of config.syncs) {
      const { from, to, ignored } = item;
      if (syncFileList.size == 0) {
        clearInterval(interval)
        chokidar.watch(to, {
          ignored: ignored
        }).on('all', async (event, path) => {
          log(`watch: file ${path} has been ${event}.`);
          await sync(to, from, ignored);
        });
      }
    }
  }, intervalTime);

  // 定时同步
  setInterval(() => {
    log('interval from->to：')
    if (syncFileList.size > 0) return
    for (const item of config.syncs) {
      const { from, to, ignored } = item;
      sync(from, to, ignored);
    }

    const interval = setInterval(() => {
      log('interval to->from：')
      if (syncFileList.size > 0) return
      clearInterval(interval)
      for (const item of config.syncs) {
        const { from, to, ignored } = item;
        sync(to, from, ignored);
      }
    }, intervalTime);

  }, intervalSyncTime);
}


// 同步
async function sync(from, to, ignored = []) {
  // 如果文件在当前同步列表中return
  if (syncFileList.has(from) || syncFileList.has(to)) {
    return
  }
  // 如果from文件不存在则return
  if (!fse.pathExistsSync(from)) {
    log(`noExist: ${from}`)
    return
  }
  // 判断from是文件还是文件夹，来自动创建，标记问新路径不进行修改时间比对
  let toIsNewFile = false
  if (!fse.pathExistsSync(to)) {
    toIsNewFile = true
    const stats = fse.statSync(from)
    if (stats.isDirectory()) {
      fse.ensureDirSync(to)
    } else {
      fse.ensureFileSync(to)
    }
  }

  if (compareFileTime(from, to) || toIsNewFile) {
    // 添加到同步列表
    syncFileList.add(from)
    syncFileList.add(to)

    try {
      // 拷贝源路径到目标路径
      log(`copy: ${from} -> ${to}`)
      await fse.copy(from, to, {
        overwrite: true,
        filter: (src) => {
          // 忽略指定的文件或文件夹
          for (const ignore of ignored) {
            if (src.includes(ignore)) {
              return false;
            }
          }
          return true;
        }
      });
    } catch (error) {
      log(`error copy: ${error.toString()}`)
    }
    setTimeout(() => {
      syncFileList.delete(from)
      syncFileList.delete(to)
    }, lockSyncTime);
  }
}

// 比较两个文件的修改时间
function compareFileTime(path1, path2) {
  const stat1 = fse.statSync(path1);
  const stat2 = fse.statSync(path2);
  // 返回 true 表示第一个文件的修改时间晚于第二个文件的修改时间
  return stat1.mtime > stat2.mtime;
}

// 日志
function log(msg) {
  const date = new Date();
  const milliseconds = date.getMilliseconds();
  console.log(`${date.toLocaleString()}.${milliseconds}: ${msg}`)
}