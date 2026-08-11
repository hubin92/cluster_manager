# -*- coding: utf-8 -*-
"""
集群管理插件 - mdserver-web
支持ARM64/AMD64架构
"""
import os
import sys
import json
import time
import subprocess
import hashlib
import uuid

# mdserver-web 公共库
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import mw

PLUGIN_NAME = 'cluster_manager'
PLUGIN_DIR = mw.getPluginDir() + '/' + PLUGIN_NAME
DATA_DIR = mw.getRunDir() + '/data/cluster_manager'
DB_FILE = DATA_DIR + '/cluster.db'
CONFIG_FILE = DATA_DIR + '/config.json'


def _ensure_dir():
    """确保数据目录存在"""
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)


def _get_db():
    """获取SQLite数据库连接"""
    _ensure_dir()
    import sqlite3
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    """初始化数据库表"""
    _ensure_dir()
    conn = _get_db()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS cluster_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS cluster_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER DEFAULT 0,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 7200,
        auth_user TEXT DEFAULT '',
        auth_token TEXT DEFAULT '',
        os_type TEXT DEFAULT '',
        arch TEXT DEFAULT '',
        status TEXT DEFAULT 'offline',
        is_master INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        last_heartbeat TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (group_id) REFERENCES cluster_groups(id)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS cluster_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id INTEGER NOT NULL,
        service_name TEXT NOT NULL,
        service_type TEXT DEFAULT 'systemd',
        display_name TEXT DEFAULT '',
        status TEXT DEFAULT 'stopped',
        auto_start INTEGER DEFAULT 0,
        is_main INTEGER DEFAULT 0,
        db_type TEXT DEFAULT '',
        db_host TEXT DEFAULT '',
        db_port INTEGER DEFAULT 0,
        db_name TEXT DEFAULT '',
        db_user TEXT DEFAULT '',
        db_password TEXT DEFAULT '',
        sub_panel_config TEXT DEFAULT '{}',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (node_id) REFERENCES cluster_nodes(id)
    )''')
    # 插入默认分组
    c.execute("SELECT COUNT(*) FROM cluster_groups")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO cluster_groups (name, icon, sort_order) VALUES ('默认分组', 'fa fa-server', 0)")
    conn.commit()
    conn.close()


def _load_config():
    """加载插件配置"""
    _ensure_dir()
    if not os.path.exists(CONFIG_FILE):
        default = {
            "main_db_type": "",
            "main_db_host": "127.0.0.1",
            "main_db_port": 0,
            "main_db_name": "mdserver_cluster",
            "main_db_user": "",
            "main_db_password": "",
            "sync_interval": 60,
            "heartbeat_timeout": 30,
            "use_external_db": False
        }
        _save_config(default)
        return default
    with open(CONFIG_FILE, 'r') as f:
        return json.load(f)


def _save_config(cfg):
    """保存插件配置"""
    _ensure_dir()
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


# ==================== 面板分组管理 ====================

def get_group_list():
    """获取所有分组列表"""
    _init_db()
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_groups ORDER BY sort_order ASC, id ASC")
    groups = [dict(row) for row in c.fetchall()]
    # 每个分组附带节点数量
    for g in groups:
        c2 = conn.cursor()
        c2.execute("SELECT COUNT(*) FROM cluster_nodes WHERE group_id=?", (g['id'],))
        g['node_count'] = c2.fetchone()[0]
    conn.close()
    return groups


def add_group(name, icon='fa fa-server'):
    """添加分组"""
    _init_db()
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT MAX(sort_order) FROM cluster_groups")
    row = c.fetchone()
    sort_order = (row[0] or 0) + 1
    c.execute("INSERT INTO cluster_groups (name, icon, sort_order) VALUES (?,?,?)",
              (name, icon, sort_order))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return mw.returnJson(True, '分组添加成功', {'id': new_id})


def edit_group(gid, name, icon=''):
    """编辑分组"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("UPDATE cluster_groups SET name=?, icon=?, updated_at=datetime('now','localtime') WHERE id=?",
              (name, icon, gid))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '分组修改成功')


def delete_group(gid):
    """删除分组"""
    conn = _get_db()
    c = conn.cursor()
    # 将该分组下的节点移到默认分组
    c.execute("SELECT id FROM cluster_groups WHERE name='默认分组' LIMIT 1")
    default = c.fetchone()
    if default:
        c.execute("UPDATE cluster_nodes SET group_id=? WHERE group_id=?", (default['id'], gid))
    c.execute("DELETE FROM cluster_groups WHERE id=?", (gid,))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '分组删除成功')


def sort_groups(sort_data):
    """拖拽排序分组
    sort_data: [{"id":1,"sort_order":0},{"id":2,"sort_order":1},...]
    """
    conn = _get_db()
    c = conn.cursor()
    for item in sort_data:
        c.execute("UPDATE cluster_groups SET sort_order=?, updated_at=datetime('now','localtime') WHERE id=?",
                  (item.get('sort_order', 0), item.get('id')))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '排序更新成功')


# ==================== 集群节点管理 ====================

def get_node_list(group_id=None):
    """获取节点列表"""
    _init_db()
    conn = _get_db()
    c = conn.cursor()
    if group_id is not None:
        c.execute("SELECT * FROM cluster_nodes WHERE group_id=? ORDER BY sort_order ASC, id ASC", (group_id,))
    else:
        c.execute("SELECT * FROM cluster_nodes ORDER BY sort_order ASC, id ASC")
    nodes = [dict(row) for row in c.fetchall()]
    # 脱敏 auth_token
    for n in nodes:
        if n['auth_token']:
            n['auth_token_mask'] = n['auth_token'][:4] + '****' + n['auth_token'][-4:]
            del n['auth_token']
    conn.close()
    return nodes


def add_node(group_id, name, host, port=7200, auth_user='', auth_token='', is_master=0):
    """添加集群节点"""
    _init_db()
    conn = _get_db()
    c = conn.cursor()
    # 检测架构
    arch = _detect_remote_arch(host, port)
    c.execute("""INSERT INTO cluster_nodes 
        (group_id, name, host, port, auth_user, auth_token, arch, is_master, status, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",
              (group_id, name, host, port, auth_user, auth_token, arch, is_master, 'offline', 0))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return mw.returnJson(True, '节点添加成功', {'id': new_id})


def edit_node(nid, **kwargs):
    """编辑节点信息"""
    conn = _get_db()
    c = conn.cursor()
    fields = []
    values = []
    for k in ['group_id', 'name', 'host', 'port', 'auth_user', 'auth_token', 'is_master']:
        if k in kwargs:
            fields.append(f"{k}=?")
            values.append(kwargs[k])
    if not fields:
        conn.close()
        return mw.returnJson(False, '无更新字段')
    fields.append("updated_at=datetime('now','localtime')")
    values.append(nid)
    sql = "UPDATE cluster_nodes SET " + ",".join(fields) + " WHERE id=?"
    c.execute(sql, values)
    conn.commit()
    conn.close()
    return mw.returnJson(True, '节点更新成功')


def delete_node(nid):
    """删除节点"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("DELETE FROM cluster_services WHERE node_id=?", (nid,))
    c.execute("DELETE FROM cluster_nodes WHERE id=?", (nid,))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '节点删除成功')


def sort_nodes(sort_data):
    """拖拽排序节点"""
    conn = _get_db()
    c = conn.cursor()
    for item in sort_data:
        c.execute("UPDATE cluster_nodes SET sort_order=?, group_id=?, updated_at=datetime('now','localtime') WHERE id=?",
                  (item.get('sort_order', 0), item.get('group_id', 0), item.get('id')))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '排序更新成功')


def move_node_to_group(nid, group_id):
    """移动节点到指定分组"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("UPDATE cluster_nodes SET group_id=?, updated_at=datetime('now','localtime') WHERE id=?",
              (group_id, nid))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '节点移动成功')


def _detect_remote_arch(host, port):
    """检测远程节点架构（通过API或SSH）"""
    try:
        # 先尝试通过面板API检测
        import urllib.request
        url = f"http://{host}:{port}/api/system/arch"
        req = urllib.request.Request(url, timeout=5)
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read().decode())
        return data.get('arch', 'unknown')
    except Exception:
        pass
    # 本地检测
    try:
        import platform
        machine = platform.machine().lower()
        if machine in ('aarch64', 'arm64'):
            return 'aarch64'
        elif machine in ('x86_64', 'amd64'):
            return 'x86_64'
        return machine
    except Exception:
        return 'unknown'


def check_node_status(nid):
    """检测节点在线状态"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_nodes WHERE id=?", (nid,))
    node = c.fetchone()
    if not node:
        conn.close()
        return mw.returnJson(False, '节点不存在')
    node = dict(node)
    status = 'offline'
    try:
        import urllib.request
        url = f"http://{node['host']}:{node['port']}/api/system/info"
        req = urllib.request.Request(url, timeout=5)
        if node['auth_token']:
            req.add_header('Authorization', f"Bearer {node['auth_token']}")
        resp = urllib.request.urlopen(req, timeout=5)
        if resp.getcode() == 200:
            status = 'online'
            data = json.loads(resp.read().decode())
            # 更新节点信息
            c.execute("""UPDATE cluster_nodes SET 
                status=?, os_type=?, arch=?, last_heartbeat=datetime('now','localtime'),
                updated_at=datetime('now','localtime') WHERE id=?""",
                      (status, data.get('os', ''), data.get('arch', ''), nid))
    except Exception:
        c.execute("UPDATE cluster_nodes SET status=?, updated_at=datetime('now','localtime') WHERE id=?",
                  ('offline', nid))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '状态检测完成', {'status': status})


def check_all_nodes_status():
    """批量检测所有节点状态"""
    _init_db()
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT id FROM cluster_nodes")
    ids = [row['id'] for row in c.fetchall()]
    conn.close()
    for nid in ids:
        check_node_status(nid)
    return mw.returnJson(True, '全部节点状态已更新')


# ==================== 服务管理 ====================

def get_service_list(node_id):
    """获取节点服务列表"""
    _init_db()
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_services WHERE node_id=? ORDER BY sort_order ASC, id ASC", (node_id,))
    services = [dict(row) for row in c.fetchall()]
    conn.close()
    # 检查实时状态
    for s in services:
        s['status'] = _get_service_real_status(node_id, s['service_name'])
        s['auto_start'] = _get_service_auto_start(node_id, s['service_name'])
    return services


def _get_service_real_status(node_id, service_name):
    """获取服务实时状态"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_nodes WHERE id=?", (node_id,))
    node = c.fetchone()
    conn.close()
    if not node:
        return 'unknown'
    try:
        import urllib.request
        url = f"http://{node['host']}:{node['port']}/api/service/status?name={service_name}"
        req = urllib.request.Request(url, timeout=5)
        if node['auth_token']:
            req.add_header('Authorization', f"Bearer {node['auth_token']}")
        resp = urllib.request.urlopen(req, timeout=5)
        data = json.loads(resp.read().decode())
        return data.get('status', 'unknown')
    except Exception:
        # 本地服务检测
        try:
            result = subprocess.run(
                ['systemctl', 'is-active', service_name],
                capture_output=True, text=True, timeout=5
            )
            if result.stdout.strip() == 'active':
                return 'running'
            elif result.stdout.strip() == 'inactive':
                return 'stopped'
            return 'unknown'
        except Exception:
            return 'unknown'


def _get_service_auto_start(node_id, service_name):
    """获取服务自启动状态"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_nodes WHERE id=?", (node_id,))
    node = c.fetchone()
    conn.close()
    if not node:
        return 0
    try:
        import urllib.request
        url = f"http://{node['host']}:{node['port']}/api/service/autostart?name={service_name}"
        req = urllib.request.Request(url, timeout=5)
        if node['auth_token']:
            req.add_header('Authorization', f"Bearer {node['auth_token']}")
        resp = urllib.request.urlopen(req, timeout=5)
        data = json.loads(resp.read().decode())
        return 1 if data.get('enabled', False) else 0
    except Exception:
        try:
            result = subprocess.run(
                ['systemctl', 'is-enabled', service_name],
                capture_output=True, text=True, timeout=5
            )
            return 1 if result.stdout.strip() == 'enabled' else 0
        except Exception:
            return 0


def _execute_remote_service(node_id, service_name, action):
    """远程执行服务操作"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_nodes WHERE id=?", (node_id,))
    node = c.fetchone()
    conn.close()
    if not node:
        return False, '节点不存在'
    try:
        import urllib.request
        url = f"http://{node['host']}:{node['port']}/api/service/{action}"
        post_data = json.dumps({"name": service_name}).encode()
        req = urllib.request.Request(url, data=post_data, timeout=10,
                                     headers={'Content-Type': 'application/json'})
        if node['auth_token']:
            req.add_header('Authorization', f"Bearer {node['auth_token']}")
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        return data.get('status', False), data.get('msg', '')
    except Exception as e:
        # 本地执行
        try:
            cmd_map = {
                'stop': 'stop',
                'restart': 'restart',
                'reload': 'reload'
            }
            subprocess.run(
                ['systemctl', cmd_map.get(action, action), service_name],
                capture_output=True, text=True, timeout=30
            )
            return True, f'{action}执行成功'
        except Exception as e2:
            return False, str(e2)


def add_service(node_id, service_name, service_type='systemd', display_name='',
                is_main=0, db_type='', db_host='', db_port=0, db_name='',
                db_user='', db_password=''):
    """添加服务"""
    _init_db()
    conn = _get_db()
    c = conn.cursor()
    c.execute("""INSERT INTO cluster_services 
        (node_id, service_name, service_type, display_name, is_main, 
         db_type, db_host, db_port, db_name, db_user, db_password)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
              (node_id, service_name, service_type, display_name, is_main,
               db_type, db_host, db_port, db_name, db_user, db_password))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return mw.returnJson(True, '服务添加成功', {'id': new_id})


def edit_service(sid, **kwargs):
    """编辑服务"""
    conn = _get_db()
    c = conn.cursor()
    fields = []
    values = []
    for k in ['service_name', 'service_type', 'display_name', 'is_main',
              'db_type', 'db_host', 'db_port', 'db_name', 'db_user',
              'db_password', 'sub_panel_config', 'sort_order']:
        if k in kwargs:
            fields.append(f"{k}=?")
            values.append(kwargs[k])
    if not fields:
        conn.close()
        return mw.returnJson(False, '无更新字段')
    fields.append("updated_at=datetime('now','localtime')")
    values.append(sid)
    sql = "UPDATE cluster_services SET " + ",".join(fields) + " WHERE id=?"
    c.execute(sql, values)
    conn.commit()
    conn.close()
    return mw.returnJson(True, '服务更新成功')


def delete_service(sid):
    """删除服务"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("DELETE FROM cluster_services WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '服务删除成功')


def service_stop(node_id, service_name):
    """停止服务"""
    ok, msg = _execute_remote_service(node_id, service_name, 'stop')
    if ok:
        return mw.returnJson(True, '服务已停止')
    return mw.returnJson(False, f'停止失败: {msg}')


def service_restart(node_id, service_name):
    """重启服务"""
    ok, msg = _execute_remote_service(node_id, service_name, 'restart')
    if ok:
        return mw.returnJson(True, '服务已重启')
    return mw.returnJson(False, f'重启失败: {msg}')


def service_reload(node_id, service_name):
    """重载配置"""
    ok, msg = _execute_remote_service(node_id, service_name, 'reload')
    if ok:
        return mw.returnJson(True, '配置已重载')
    return mw.returnJson(False, f'重载失败: {msg}')


def service_set_auto_start(node_id, service_name, enabled):
    """设置服务自启动"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_nodes WHERE id=?", (node_id,))
    node = c.fetchone()
    conn.close()
    if not node:
        return mw.returnJson(False, '节点不存在')
    try:
        import urllib.request
        url = f"http://{node['host']}:{node['port']}/api/service/autostart"
        post_data = json.dumps({"name": service_name, "enabled": enabled}).encode()
        req = urllib.request.Request(url, data=post_data, timeout=10,
                                     headers={'Content-Type': 'application/json'})
        if node['auth_token']:
            req.add_header('Authorization', f"Bearer {node['auth_token']}")
        resp = urllib.request.urlopen(req, timeout=10)
        return mw.returnJson(True, '自启动设置成功')
    except Exception:
        try:
            if enabled:
                subprocess.run(['systemctl', 'enable', service_name],
                               capture_output=True, text=True, timeout=10)
            else:
                subprocess.run(['systemctl', 'disable', service_name],
                               capture_output=True, text=True, timeout=10)
            return mw.returnJson(True, '自启动设置成功')
        except Exception as e:
            return mw.returnJson(False, f'设置失败: {e}')


# ==================== 主服务数据库配置 ====================

def get_main_db_config():
    """获取主服务数据库配置"""
    cfg = _load_config()
    return cfg


def save_main_db_config(db_type, db_host, db_port, db_name, db_user, db_password,
                        use_external_db=False, sync_interval=60, heartbeat_timeout=30):
    """保存主服务数据库配置"""
    cfg = _load_config()
    cfg['main_db_type'] = db_type
    cfg['main_db_host'] = db_host
    cfg['main_db_port'] = db_port
    cfg['main_db_name'] = db_name
    cfg['main_db_user'] = db_user
    cfg['main_db_password'] = db_password
    cfg['use_external_db'] = use_external_db
    cfg['sync_interval'] = sync_interval
    cfg['heartbeat_timeout'] = heartbeat_timeout
    _save_config(cfg)
    return mw.returnJson(True, '主服务数据库配置已保存')


def test_db_connection(db_type, db_host, db_port, db_name, db_user, db_password):
    """测试数据库连接"""
    try:
        if db_type == 'mysql':
            import pymysql
            conn = pymysql.connect(
                host=db_host, port=int(db_port), user=db_user,
                password=db_password, database=db_name, connect_timeout=5
            )
            conn.close()
            return mw.returnJson(True, 'MySQL连接成功')
        elif db_type == 'mariadb':
            import pymysql
            conn = pymysql.connect(
                host=db_host, port=int(db_port), user=db_user,
                password=db_password, database=db_name, connect_timeout=5
            )
            conn.close()
            return mw.returnJson(True, 'MariaDB连接成功')
        elif db_type == 'postgresql':
            import psycopg2
            conn = psycopg2.connect(
                host=db_host, port=int(db_port), user=db_user,
                password=db_password, dbname=db_name, connect_timeout=5
            )
            conn.close()
            return mw.returnJson(True, 'PostgreSQL连接成功')
        else:
            return mw.returnJson(False, f'不支持的数据库类型: {db_type}')
    except Exception as e:
        return mw.returnJson(False, f'连接失败: {e}')


def get_installed_databases():
    """获取已安装的数据库类型"""
    db_list = []
    # 检测MySQL
    try:
        result = subprocess.run(['which', 'mysql'], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            # 检测端口
            result2 = subprocess.run(['mysqladmin', 'status'], capture_output=True, text=True, timeout=5)
            db_list.append({
                'type': 'mysql',
                'name': 'MySQL',
                'installed': True,
                'running': result2.returncode == 0,
                'default_port': 3306
            })
    except Exception:
        pass
    # 检测MariaDB
    try:
        result = subprocess.run(['which', 'mariadb'], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            db_list.append({
                'type': 'mariadb',
                'name': 'MariaDB',
                'installed': True,
                'running': True,
                'default_port': 3306
            })
    except Exception:
        pass
    # 检测PostgreSQL
    try:
        result = subprocess.run(['which', 'psql'], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            db_list.append({
                'type': 'postgresql',
                'name': 'PostgreSQL',
                'installed': True,
                'running': True,
                'default_port': 5432
            })
    except Exception:
        pass
    # 通过面板API检测已安装的数据库插件
    try:
        plugin_dir = mw.getRunDir() + '/plugins'
        for d in os.listdir(plugin_dir):
            if d in ('mysql', 'mariadb', 'postgresql', 'pgsql'):
                info_file = os.path.join(plugin_dir, d, 'info.json')
                if os.path.exists(info_file):
                    with open(info_file) as f:
                        info = json.load(f)
                    db_list.append({
                        'type': d,
                        'name': info.get('title', d),
                        'installed': True,
                        'running': True,
                        'default_port': 3306 if d in ('mysql', 'mariadb') else 5432
                    })
    except Exception:
        pass
    return db_list


def init_external_db():
    """初始化外部数据库（创建表结构）"""
    cfg = _load_config()
    if not cfg.get('use_external_db'):
        return mw.returnJson(False, '未启用外部数据库')
    db_type = cfg.get('main_db_type')
    try:
        if db_type in ('mysql', 'mariadb'):
            import pymysql
            conn = pymysql.connect(
                host=cfg['main_db_host'], port=int(cfg['main_db_port']),
                user=cfg['main_db_user'], password=cfg['main_db_password'],
                database=cfg['main_db_name'], connect_timeout=10
            )
            c = conn.cursor()
            c.execute('''CREATE TABLE IF NOT EXISTS cluster_groups (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(100) DEFAULT '',
                sort_order INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''')
            c.execute('''CREATE TABLE IF NOT EXISTS cluster_nodes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                group_id INT DEFAULT 0,
                name VARCHAR(100) NOT NULL,
                host VARCHAR(255) NOT NULL,
                port INT DEFAULT 7200,
                auth_user VARCHAR(100) DEFAULT '',
                auth_token VARCHAR(255) DEFAULT '',
                os_type VARCHAR(50) DEFAULT '',
                arch VARCHAR(50) DEFAULT '',
                status VARCHAR(20) DEFAULT 'offline',
                is_master TINYINT DEFAULT 0,
                sort_order INT DEFAULT 0,
                last_heartbeat DATETIME DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''')
            c.execute('''CREATE TABLE IF NOT EXISTS cluster_services (
                id INT AUTO_INCREMENT PRIMARY KEY,
                node_id INT NOT NULL,
                service_name VARCHAR(100) NOT NULL,
                service_type VARCHAR(50) DEFAULT 'systemd',
                display_name VARCHAR(100) DEFAULT '',
                status VARCHAR(20) DEFAULT 'stopped',
                auto_start TINYINT DEFAULT 0,
                is_main TINYINT DEFAULT 0,
                db_type VARCHAR(50) DEFAULT '',
                db_host VARCHAR(255) DEFAULT '',
                db_port INT DEFAULT 0,
                db_name VARCHAR(100) DEFAULT '',
                db_user VARCHAR(100) DEFAULT '',
                db_password VARCHAR(255) DEFAULT '',
                sub_panel_config TEXT DEFAULT '{}',
                sort_order INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''')
            conn.commit()
            conn.close()
            return mw.returnJson(True, 'MySQL/MariaDB数据库初始化成功')
        elif db_type == 'postgresql':
            import psycopg2
            conn = psycopg2.connect(
                host=cfg['main_db_host'], port=int(cfg['main_db_port']),
                user=cfg['main_db_user'], password=cfg['main_db_password'],
                dbname=cfg['main_db_name'], connect_timeout=10
            )
            c = conn.cursor()
            c.execute('''CREATE TABLE IF NOT EXISTS cluster_groups (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(100) DEFAULT '',
                sort_order INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS cluster_nodes (
                id SERIAL PRIMARY KEY,
                group_id INT DEFAULT 0,
                name VARCHAR(100) NOT NULL,
                host VARCHAR(255) NOT NULL,
                port INT DEFAULT 7200,
                auth_user VARCHAR(100) DEFAULT '',
                auth_token VARCHAR(255) DEFAULT '',
                os_type VARCHAR(50) DEFAULT '',
                arch VARCHAR(50) DEFAULT '',
                status VARCHAR(20) DEFAULT 'offline',
                is_master SMALLINT DEFAULT 0,
                sort_order INT DEFAULT 0,
                last_heartbeat TIMESTAMP DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS cluster_services (
                id SERIAL PRIMARY KEY,
                node_id INT NOT NULL,
                service_name VARCHAR(100) NOT NULL,
                service_type VARCHAR(50) DEFAULT 'systemd',
                display_name VARCHAR(100) DEFAULT '',
                status VARCHAR(20) DEFAULT 'stopped',
                auto_start SMALLINT DEFAULT 0,
                is_main SMALLINT DEFAULT 0,
                db_type VARCHAR(50) DEFAULT '',
                db_host VARCHAR(255) DEFAULT '',
                db_port INT DEFAULT 0,
                db_name VARCHAR(100) DEFAULT '',
                db_user VARCHAR(100) DEFAULT '',
                db_password VARCHAR(255) DEFAULT '',
                sub_panel_config TEXT DEFAULT '{}',
                sort_order INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')
            conn.commit()
            conn.close()
            return mw.returnJson(True, 'PostgreSQL数据库初始化成功')
        else:
            return mw.returnJson(False, f'不支持的数据库类型: {db_type}')
    except Exception as e:
        return mw.returnJson(False, f'初始化失败: {e}')


# ==================== 子面板设置 ====================

def get_sub_panel_config(service_id):
    """获取子面板配置"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_services WHERE id=?", (service_id,))
    service = c.fetchone()
    conn.close()
    if not service:
        return {}
    try:
        return json.loads(service['sub_panel_config'] or '{}')
    except Exception:
        return {}


def save_sub_panel_config(service_id, config):
    """保存子面板配置"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("UPDATE cluster_services SET sub_panel_config=?, updated_at=datetime('now','localtime') WHERE id=?",
              (json.dumps(config, ensure_ascii=False), service_id))
    conn.commit()
    conn.close()
    return mw.returnJson(True, '子面板配置已保存')


def sync_sub_panel_config(node_id, service_id):
    """同步子面板配置到远程节点"""
    conn = _get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM cluster_services WHERE id=?", (service_id,))
    service = c.fetchone()
    c.execute("SELECT * FROM cluster_nodes WHERE id=?", (node_id,))
    node = c.fetchone()
    conn.close()
    if not service or not node:
        return mw.returnJson(False, '服务或节点不存在')
    try:
        import urllib.request
        config = json.loads(service['sub_panel_config'] or '{}')
        url = f"http://{node['host']}:{node['port']}/api/service/config"
        post_data = json.dumps({
            "name": service['service_name'],
            "config": config
        }).encode()
        req = urllib.request.Request(url, data=post_data, timeout=10,
                                     headers={'Content-Type': 'application/json'})
        if node['auth_token']:
            req.add_header('Authorization', f"Bearer {node['auth_token']}")
        resp = urllib.request.urlopen(req, timeout=10)
        return mw.returnJson(True, '子面板配置同步成功')
    except Exception as e:
        return mw.returnJson(False, f'同步失败: {e}')


# ==================== 插件生命周期 ====================

def install():
    """安装插件"""
    _init_db()
    return 'ok'


def uninstall():
    """卸载插件"""
    return 'ok'


def status():
    """获取插件状态"""
    _init_db()
    return '1'


def get_index():
    """获取插件首页模板"""
    return PLUGIN_DIR + '/index.html'