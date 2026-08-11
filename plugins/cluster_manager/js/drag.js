/**
 * 拖拽排序模块
 * 支持分组拖拽排序和节点跨分组拖拽
 */
class DragSort {
    constructor(options) {
        this.container = options.container;       // 容器选择器
        this.itemSelector = options.itemSelector;  // 可拖拽元素选择器
        this.handle = options.handle || null;       // 拖拽手柄选择器
        this.onDragStart = options.onDragStart || function(){};
        this.onDragOver = options.onDragOver || function(){};
        this.onDragEnd = options.onDragEnd || function(){};
        this.onDrop = options.onDrop || function(){};
        this.groupSelector = options.groupSelector || null; // 跨分组拖拽时的分组选择器
        this.dragData = null;
        this.placeholder = null;
        this.init();
    }

    init() {
        const self = this;
        const container = document.querySelector(this.container);
        if (!container) return;

        // 使用事件委托
        container.addEventListener('mousedown', function(e) {
            const handle = self.handle ? e.target.closest(self.handle) : e.target.closest(self.itemSelector);
            if (!handle) return;
            const item = e.target.closest(self.itemSelector);
            if (!item) return;

            e.preventDefault();
            self._startDrag(e, item);
        });

        // 全局事件
        document.addEventListener('mousemove', function(e) {
            if (self.dragData) {
                self._onDrag(e);
            }
        });

        document.addEventListener('mouseup', function(e) {
            if (self.dragData) {
                self._endDrag(e);
            }
        });

        // 触摸支持（移动端）
        container.addEventListener('touchstart', function(e) {
            const handle = self.handle ? e.target.closest(self.handle) : e.target.closest(self.itemSelector);
            if (!handle) return;
            const item = e.target.closest(self.itemSelector);
            if (!item) return;
            self._startDrag(e.touches[0], item);
        }, {passive: false});

        document.addEventListener('touchmove', function(e) {
            if (self.dragData) {
                e.preventDefault();
                self._onDrag(e.touches[0]);
            }
        }, {passive: false});

        document.addEventListener('touchend', function(e) {
            if (self.dragData) {
                self._endDrag(e.changedTouches[0]);
            }
        });
    }

    _startDrag(e, item) {
        this.dragData = {
            el: item,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: 0,
            offsetY: 0,
            id: item.dataset.id,
            groupId: item.dataset.groupId || ''
        };

        item.classList.add('dragging');

        // 创建占位符
        this.placeholder = document.createElement('div');
        this.placeholder.className = 'drag-placeholder';
        this.placeholder.style.height = item.offsetHeight + 'px';

        this.onDragStart(this.dragData);
    }

    _onDrag(e) {
        if (!this.dragData) return;

        const container = document.querySelector(this.container);
        const items = container.querySelectorAll(this.itemSelector + ':not(.dragging)');
        
        // 查找最近的元素
        let closestItem = null;
        let closestOffset = Infinity;

        items.forEach(item => {
            const rect = item.getBoundingClientRect();
            const offset = e.clientY - (rect.top + rect.height / 2);
            if (Math.abs(offset) < Math.abs(closestOffset)) {
                closestOffset = offset;
                closestItem = item;
            }
        });

        // 移除所有 drag-over
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

        // 检查是否跨分组拖拽
        if (this.groupSelector && closestItem) {
            const targetGroup = closestItem.closest(this.groupSelector);
            const sourceGroup = this.dragData.el.closest(this.groupSelector);
            if (targetGroup && targetGroup !== sourceGroup) {
                targetGroup.classList.add('drag-over');
                this.dragData.targetGroupId = targetGroup.dataset.groupId;
            } else if (targetGroup) {
                this.dragData.targetGroupId = null;
            }
        }

        if (closestItem) {
            closestItem.classList.add('drag-over');
            if (closestOffset > 0) {
                closestItem.after(this.placeholder);
            } else {
                closestItem.before(this.placeholder);
            }
        }

        this.onDragOver(this.dragData);
    }

    _endDrag(e) {
        if (!this.dragData) return;

        const container = document.querySelector(this.container);
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        this.dragData.el.classList.remove('dragging');

        // 移除占位符
        if (this.placeholder && this.placeholder.parentNode) {
            this.placeholder.parentNode.removeChild(this.placeholder);
        }

        // 计算新排序
        const items = container.querySelectorAll(this.itemSelector);
        const sortData = [];
        items.forEach((item, index) => {
            sortData.push({
                id: parseInt(item.dataset.id),
                sort_order: index,
                group_id: this.dragData.targetGroupId ? parseInt(this.dragData.targetGroupId) : parseInt(item.dataset.groupId || 0)
            });
        });

        this.onDrop(sortData, this.dragData);
        this.dragData = null;
        this.placeholder = null;
    }
}

// 导出
window.DragSort = DragSort;