#!/bin/bash
# 集群管理插件安装脚本
# 支持: x86_64 / aarch64 (ARM64)

PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/local/bin:/usr/local/sbin:~/bin
export PATH

# 获取架构
ARCH=$(uname -m)
echo "当前架构: $ARCH"

if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
    echo "不支持的架构: $ARCH"
    echo "仅支持: x86_64 (AMD64) / aarch64 (ARM64)"
    exit 1
fi

# 统一 aarch64/arm64
if [ "$ARCH" = "arm64" ]; then
    ARCH="aarch64"
fi

MW_DIR=$(cd "$(dirname "$0")/../../.." && pwd)
PLUGIN_DIR="${MW_DIR}/plugins/cluster_manager"
DATA_DIR="${MW_DIR}/data/cluster_manager"

echo "插件目录: ${PLUGIN_DIR}"
echo "数据目录: ${DATA_DIR}"

# 创建数据目录
mkdir -p "${DATA_DIR}"

# 检查Python依赖
echo "检查Python依赖..."

check_and_install() {
    python3 -c "import $1" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "安装 $2 ..."
        pip3 install "$2" -q
    fi
}

# PostgreSQL 驱动（可选）
check_and_install psycopg2 psycopg2-binary

# MySQL 驱动（可选）
check_and_install pymysql pymysql

echo "集群管理插件安装完成! [${ARCH}]"
exit 0