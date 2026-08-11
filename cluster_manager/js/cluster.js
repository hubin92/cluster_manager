/**
 * 集群管理前端应用
 */
var clusterApp = {
    currentGroupId: null,
    currentNodeId: null,
    groups: [],
    nodes: [],
    services: [],
    groupDragSort: null,
    nodeDragSort: null,

    init: function() {
        this.loadGroups();
        this.initGroupDragSort();
    },

    // ==================== API 调用 ====================
    api: function(action, data, callback) {
        $.post('/plugins/run', {
            name: 'cluster_manager',
            func: action,
            args: JSON.stringify(data || [])
        }, function(r) {
            if (typeof callback === 'function') {
                try {
                    var res = typeof r === 'string' ? JSON.parse(r) : r;
                    callback(res);
                } catch(e) {
                    callback({status: false, msg: '解析错误'});
                }
            }
        });
    },

    // ==================== 分组管理 ====================
    loadGroups: function() {
        var self = this;
        this.api('get_group_list', [], function(r) {
            if (r.status) {
                self.groups = r.data || r.msg || [];
                self.renderGroups();
            }
        });
    },

    renderGroups: function() {
        var html = '';
        var self = this;
        this.groups.forEach(function(g) {
            var activeClass = (self.currentGroupId === g.id) ? 'active' : '';
            html += '<div class="group-item ' + activeClass + '" data-id="' + g.id + '" data-group-id="' + g.id + '">' +
                '<span class="drag-handle"><i class="fa fa-grip-vertical"></i></span>' +
                '<span class="group-icon"><i class="fa ' + (g.icon || 'fa-server') + '"></i></span>' +
                '<span class="group-name">' + g.name + '</span>' +
                '<span class="group-count">' + (g.node_count || 0) + '</span>' +
                '<span class="group-actions">' +
                    '<a href="javascript:;" onclick="clusterApp.editGroup(' + g.id + ')" title="编辑"><i class="fa fa-edit"></i></a>' +
                    '<a href="javascript:;" onclick="clusterApp.deleteGroup(' + g.id + ')" title="删除"><i class="fa fa-trash"></i></a>' +
                '</span>' +
            '</div>';
        });
        $('#groupList').html(html);

        // 绑定点击事件
        $('#groupList .group-item').on('click', function(e) {
            if ($(e.target).closest('.group-actions').length || $(e.target).closest('.drag-handle').length) return;
            var gid = parseInt($(this).data('id'));
            self.selectGroup(gid);
        });

        // 初始化分组拖拽
        this.initGroupDragSort();
    },

    selectGroup: function(gid) {
        this.currentGroupId = gid;
        $('#groupList .group-item').removeClass('active');
        $('#groupList .group-item[data-id="' + gid + '"]').addClass('active');
        this.loadNodes(gid);
    },

    addGroup: function() {
        $('#groupEditId').val('');
        $('#groupName').val('');
        $('#groupIcon').val('fa fa-server');
        $('#groupModalTitle').text('添加分组');
        $('#groupModal').modal('show');
    },

    editGroup: function(gid) {
        var group = this.groups.find(function(g) { return g.id === gid; });
        if (!group) return;
        $('#groupEditId').val(gid);
        $('#groupName').val(group.name);
        $('#groupIcon').val(group.icon || 'fa fa-server');
        $('#groupModalTitle').text('编辑分组');
        $('#groupModal').modal('show');
    },

    saveGroup: function() {
        var self = this;
        var id = $('#groupEditId').val();
        var name = $('#groupName').val();
        var icon = $('#groupIcon').val();

        if (!name) {
            layer.msg('请输入分组名称', {icon: 2});
            return;
        }

        if (id) {
            this.api('edit_group', [parseInt(id), name, icon], function(r) {
                if (r.status) {
                    layer.msg('分组修改成功', {icon: 1});
                    $('#groupModal').modal('hide');
                    self.loadGroups();
                } else {
                    layer.msg(r.msg || '操作失败', {icon: 2});
                }
            });
        } else {
            this.api('add_group', [name, icon], function(r) {
                if (r.status) {
                    layer.msg('分组添加成功', {icon: 1});
                    $('#groupModal').modal('hide');
                    self.loadGroups();
                } else {
                    layer.msg(r.msg || '操作失败', {icon: 2});
                }
            });
        }
    },

    deleteGroup: function(gid) {
        var self = this;
        layer.confirm('确定删除此分组？分组下的节点将移到默认分组', function(index) {
            self.api('delete_group', [gid], function(r) {
                if (r.status) {
                    layer.msg('分组已删除', {icon: 1});
                    self.loadGroups();
                    if (self.currentGroupId === gid) {
                        self.currentGroupId = null;
                        self.renderContentPlaceholder();
                    }
                } else {
                    layer.msg(r.msg || '删除失败', {icon: 2});
                }
            });
            layer.close(index);
        });
    },

    initGroupDragSort: function() {
        var self = this;
        if (this.groupDragSort) return;
        this.groupDragSort = new DragSort({
            container: '#groupList',
            itemSelector: '.group-item',
            handle: '.drag-handle',
            onDrop: function(sortData) {
                self.api('sort_groups', [sortData], function(r) {
                    if (r.status) {
                        self.loadGroups();
                    }
                });
            }
        });
    },

    // ==================== 节点管理 ====================
    loadNodes: function(groupId) {
        var self = this;
        this.api('get_node_list', [groupId], function(r) {
            if (r.status) {
                self.nodes = r.data || r.msg || [];
                self.renderNodes();
            }
        });
    },

    renderNodes: function() {
        var html = '';
        var self = this;

        if (this.nodes.length === 0) {
            html = '<div class="content-placeholder">' +
                '<i class="fa fa-server" style="font-size:48px;color:#ccc;"></i>' +
                '<p>暂无节点，点击"添加节点"开始</p>' +
            '</div>';
            $('#clusterContent').html(html);
            return;
        }

        this.nodes.forEach(function(node) {
            var statusClass = node.status === 'online' ? 'online' : 'offline';
            var statusText = node.status === 'online' ? '在线' : '离线';
            var archClass = (node.arch === 'aarch64' || node.arch === 'arm64') ? 'arm' : 'amd';
            var archText = node.arch === 'aarch64' || node.arch === 'arm64' ? 'ARM64' : 
                           node.arch === 'x86_64' ? 'AMD64' : node.arch || '未知';
            var masterHtml = node.is_master ? '<span class="master-badge">主节点</span>' : '';

            html += '<div class="node-card" data-id="' + node.id + '" data-group-id="' + node.group_id + '">' +
                '<div class="node-card-header">' +
                    '<span class="drag-handle"><i class="fa fa-grip-vertical"></i></span>' +
                    '<span class="node-name">' + node.name + '</span>' +
                    '<span class="node-host">' + node.host + ':' + node.port + '</span>' +
                    '<span class="node-arch ' + archClass + '">' + archText + '</span>' +
                    masterHtml +
                    '<span class="node-status">' +
                        '<span class="status-dot ' + statusClass + '"></span>' +
                        '<span class="status-text">' + statusText + '</span>' +
                        '<a href="javascript:;" onclick="clusterApp.checkNodeStatus(' + node.id + ')" title="刷新状态" style="margin-left:5px;"><i class="fa fa-refresh"></i></a>' +
                        '<a href="javascript:;" onclick="clusterApp.addNodeService(' + node.id + ')" title="添加服务" style="margin-left:5px;"><i class="fa fa-plus"></i></a>' +
                        '<a href="javascript:;" onclick="clusterApp.editNode(' + node.id + ')" title="编辑" style="margin-left:5px;"><i class="fa fa-edit"></i></a>' +
                        '<a href="javascript:;" onclick="clusterApp.deleteNode(' + node.id + ')" title="删除" style="margin-left:5px;"><i class="fa fa-trash"></i></a>' +
                    '</span>' +
                '</div>' +
                '<div class="node-card-body" id="nodeBody_' + node.id + '">' +
                    self.renderNodeServices(node.id) +
                '</div>' +
            '</div>';
        });

        $('#clusterContent').html(html);
        this.initNodeDragSort();

        // 加载每个节点的服务
        this.nodes.forEach(function(node) {
            self.loadServices(node.id);
        });
    },

    renderNodeServices: function(nodeId) {
        return '<div class="service-loading" id="serviceLoading_' + nodeId + '">' +
            '<i class="fa fa-spinner fa-spin"></i> 加载服务中...' +
        '</div>';
    },

    addNode: function() {
        $('#nodeEditId').val('');
        $('#nodeName').val('');
        $('#nodeHost').val('');
        $('#nodePort').val('7200');
        $('#nodeAuthUser').val('');
        $('#nodeAuthToken').val('');
        $('#nodeIsMaster').prop('checked', false);
        $('#nodeModalTitle').text('添加节点');
        this.loadGroupOptions();
        $('#nodeModal').modal('show');
    },

    editNode: function(nid) {
        var node = this.nodes.find(function(n) { return n.id === nid; });
        if (!node) return;
        $('#nodeEditId').val(nid);
        $('#nodeName').val(node.name);
        $('#nodeHost').val(node.host);
        $('#nodePort').val(node.port);
        $('#nodeAuthUser').val(node.auth_user || '');
        $('#nodeIsMaster').prop('checked', node.is_master === 1);
        $('#nodeModalTitle').text('编辑节点');
        this.loadGroupOptions(node.group_id);
        $('#nodeModal').modal('show');
    },

    saveNode: function() {
        var self = this;
        var id = $('#nodeEditId').val();
        var data = {
            group_id: parseInt($('#nodeGroupId').val()),
            name: $('#nodeName').val(),
            host: $('#nodeHost').val(),
            port: parseInt($('#nodePort').val()),
            auth_user: $('#nodeAuthUser').val(),
            auth_token: $('#nodeAuthToken').val(),
            is_master: $('#nodeIsMaster').is(':checked') ? 1 : 0
        };

        if (!data.name || !data.host) {
            layer.msg('请填写节点名称和主机地址', {icon: 2});
            return;
        }

        if (id) {
            data.id = parseInt(id);
            this.api('edit_node', [data], function(r) {
                if (r.status) {
                    layer.msg('节点更新成功', {icon: 1});
                    $('#nodeModal').modal('hide');
                    self.loadNodes(self.currentGroupId);
                } else {
                    layer.msg(r.msg || '操作失败', {icon: 2});
                }
            });
        } else {
            this.api('add_node', [data.group_id, data.name, data.host, data.port,
                data.auth_user, data.auth_token, data.is_master], function(r) {
                if (r.status) {
                    layer.msg('节点添加成功', {icon: 1});
                    $('#nodeModal').modal('hide');
                    self.loadNodes(self.currentGroupId);
                    self.loadGroups(); // 刷新分组节点数
                } else {
                    layer.msg(r.msg || '操作失败', {icon: 2});
                }
            });
        }
    },

    deleteNode: function(nid) {
        var self = this;
        layer.confirm('确定删除此节点？关联的服务也将被删除', function(index) {
            self.api('delete_node', [nid], function(r) {
                if (r.status) {
                    layer.msg('节点已删除', {icon: 1});
                    self.loadNodes(self.currentGroupId);
                    self.loadGroups();
                } else {
                    layer.msg(r.msg || '删除失败', {icon: 2});
                }
            });
            layer.close(index);
        });
    },

    checkNodeStatus: function(nid) {
        var self = this;
        this.api('check_node_status', [nid], function(r) {
            if (r.status) {
                layer.msg('状态: ' + (r.data.status === 'online' ? '在线' : '离线'), {icon: 1});
                self.loadNodes(self.currentGroupId);
            }
        });
    },

    refreshAll: function() {
        var self = this;
        layer.msg('正在刷新所有节点状态...', {icon: 16, time: 0, shade: 0.3});
        this.api('check_all_nodes_status', [], function(r) {
            layer.closeAll();
            if (r.status) {
                layer.msg('状态刷新完成', {icon: 1});
                self.loadNodes(self.currentGroupId);
            }
        });
    },

    loadGroupOptions: function(selectedGroupId) {
        var html = '';
        this.groups.forEach(function(g) {
            var selected = (g.id === selectedGroupId) ? 'selected' : '';
            html += '<option value="' + g.id + '" ' + selected + '>' + g.name + '</option>';
        });
        $('#nodeGroupId').html(html);
    },

    initNodeDragSort: function() {
        var self = this;
        if (this.nodeDragSort) {
            // 重新初始化
            this.nodeDragSort = null;
        }
        this.nodeDragSort = new DragSort({
            container: '#clusterContent',
            itemSelector: '.node-card',
            handle: '.drag-handle',
            groupSelector: '.cluster-sidebar',
            onDrop: function(sortData) {
                self.api('sort_nodes', [sortData], function(r) {
                    if (r.status) {
                        // 如果有跨分组移动，刷新
                        var hasGroupChange = sortData.some(function(s) {
                            return s.group_id !== self.currentGroupId;
                        });
                        if (hasGroupChange) {
                            self.loadGroups();
                        }
                    }
                });
            }
        });
    },

    // ==================== 服务管理 ====================
    loadServices: function(nodeId) {
        var self = this;
        this.api('get_service_list', [nodeId], function(r) {
            if (r.status) {
                var services = r.data || r.msg || [];
                self.renderServices(nodeId, services);
            }
        });
    },

    renderServices: function(nodeId, services) {
        var html = '';
        var self = this;

        // 服务栏
        html += '<div class="service-section">';
        html += '<div class="service-section-title"><i class="fa fa-cogs"></i> 服务管理</div>';
        
        if (services.length === 0) {
            html += '<div style="color:#999;font-size:12px;padding:10px;">暂无服务，点击 + 添加</div>';
        }

        services.forEach(function(svc) {
            var statusClass = svc.status === 'running' ? 'running' : 'stopped';
            var statusText = svc.status === 'running' ? '运行中' : 
                            svc.status === 'stopped' ? '已停止' : '未知';

            // 主服务标识
            var mainBadge = svc.is_main ? '<span style="color:#d48806;font-size:11px;margin-left:5px;">[主服务]</span>' : '';

            html += '<div class="service-item">';
            html += '<span class="service-name">' + (svc.display_name || svc.service_name) + mainBadge + '</span>';
            html += '<span class="service-status">';
            html += '<span class="status-dot ' + (svc.status === 'running' ? 'online' : 'offline') + '"></span>';
            html += '<span class="' + statusClass + '">' + statusText + '</span>';
            html += '</span>';
            html += '<span class="service-actions">';
            html += '<button class="btn btn-warning btn-xs" onclick="clusterApp.serviceStop(' + nodeId + ',\'' + svc.service_name + '\')">停止</button>';
            html += '<button class="btn btn-info btn-xs" onclick="clusterApp.serviceRestart(' + nodeId + ',\'' + svc.service_name + '\')">重启</button>';
            html += '<button class="btn btn-default btn-xs" onclick="clusterApp.serviceReload(' + nodeId + ',\'' + svc.service_name + '\')">重载</button>';
            html += '<button class="btn btn-danger btn-xs" onclick="clusterApp.deleteService(' + svc.id + ')"><i class="fa fa-trash"></i></button>';
            html += '</span>';
            html += '</div>';
        });
        html += '</div>';

        // 自启动栏
        html += '<div class="autostart-section">';
        html += '<div class="service-section-title"><i class="fa fa-play-circle"></i> 自启动管理</div>';
        services.forEach(function(svc) {
            var autoEnabled = svc.auto_start === 1;
            html += '<div class="autostart-item">';
            html += '<span class="service-name">' + (svc.display_name || svc.service_name) + '</span>';
            html += '<span class="auto-status">';
            html += '<span class="' + (autoEnabled ? 'enabled' : 'disabled') + '">' + (autoEnabled ? '已启用' : '已禁用') + '</span>';
            if (autoEnabled) {
                html += '<button class="btn btn-danger btn-xs" onclick="clusterApp.setAutoStart(' + nodeId + ',\'' + svc.service_name + '\',false)">停止自启</button>';
            } else {
                html += '<button class="btn btn-success btn-xs" onclick="clusterApp.setAutoStart(' + nodeId + ',\'' + svc.service_name + '\',true)">启用自启</button>';
            }
            html += '</span>';
            html += '</div>';
        });
        html += '</div>';

        // 主服务栏
        var mainServices = services.filter(function(s) { return s.is_main === 1; });
        if (mainServices.length > 0) {
            html += '<div class="main-service-section">';
            html += '<div class="section-title"><i class="fa fa-database"></i> 主服务设置</div>';
            mainServices.forEach(function(svc) {
                html += '<div class="db-config-info">';
                if (svc.db_type) {
                    html += '<span class="db-info-item"><i class="fa fa-database"></i> ' + svc.db_type.toUpperCase() + '</span>';
                    html += '<span class="db-info-item"><i class="fa fa-server"></i> ' + svc.db_host + ':' + svc.db_port + '</span>';
                    html += '<span class="db-info-item"><i class="fa fa-folder"></i> ' + svc.db_name + '</span>';
                } else {
                    html += '<span class="db-info-item" style="color:#fa8c16;">尚未配置数据库</span>';
                }
                html += '<button class="btn btn-warning btn-xs" onclick="clusterApp.editServiceDb(' + svc.id + ')"><i class="fa fa-cog"></i> 配置数据库</button>';
                html += '</div>';
            });
            html += '</div>';
        }

        // 子面板设置
        html += '<div class="sub-panel-section">';
        html += '<div class="service-section-title"><i class="fa fa-sliders"></i> 子面板设置</div>';
        services.forEach(function(svc) {
            html += '<div class="autostart-item">';
            html += '<span class="service-name">' + (svc.display_name || svc.service_name) + '</span>';
            html += '<span class="auto-status">';
            html += '<button class="btn btn-info btn-xs sub-panel-btn" onclick="clusterApp.openSubPanelConfig(' + svc.id + ',' + nodeId + ')"><i class="fa fa-cog"></i> 设置</button>';
            html += '</span>';
            html += '</div>';
        });
        html += '</div>';

        $('#nodeBody_' + nodeId).html(html);
    },

    addNodeService: function(nodeId) {
        var self = this;
        var serviceName = '';
        var displayName = '';
        var isMain = 0;

        layer.open({
            type: 1,
            title: '添加服务',
            area: ['400px', '350px'],
            content: '<div style="padding:20px;">' +
                '<div class="form-group"><label>服务名称</label><input type="text" class="form-control" id="newServiceName" placeholder="如: nginx, mdserver-web"></div>' +
                '<div class="form-group"><label>显示名称</label><input type="text" class="form-control" id="newServiceDisplay" placeholder="如: Nginx Web服务"></div>' +
                '<div class="form-group"><label class="inline-label"><input type="checkbox" id="newServiceIsMain"> 设为主服务</label></div>' +
                '<button class="btn btn-primary" onclick="clusterApp.saveNewService(' + nodeId + ')">添加</button>' +
            '</div>'
        });
    },

    saveNewService: function(nodeId) {
        var self = this;
        var serviceName = $('#newServiceName').val();
        var displayName = $('#newServiceDisplay').val();
        var isMain = $('#newServiceIsMain').is(':checked') ? 1 : 0;

        if (!serviceName) {
            layer.msg('请输入服务名称', {icon: 2});
            return;
        }

        this.api('add_service', [nodeId, serviceName, 'systemd', displayName, isMain], function(r) {
            if (r.status) {
                layer.closeAll();
                layer.msg('服务添加成功', {icon: 1});
                self.loadServices(nodeId);
            } else {
                layer.msg(r.msg || '添加失败', {icon: 2});
            }
        });
    },

    deleteService: function(sid) {
        var self = this;
        layer.confirm('确定删除此服务？', function(index) {
            self.api('delete_service', [sid], function(r) {
                if (r.status) {
                    layer.msg('服务已删除', {icon: 1});
                    // 刷新当前节点
                    if (self.currentGroupId) {
                        self.loadNodes(self.currentGroupId);
                    }
                } else {
                    layer.msg(r.msg || '删除失败', {icon: 2});
                }
            });
            layer.close(index);
        });
    },

    serviceStop: function(nodeId, serviceName) {
        var self = this;
        this.api('service_stop', [nodeId, serviceName], function(r) {
            layer.msg(r.msg || '操作完成', {icon: r.status ? 1 : 2});
            setTimeout(function() { self.loadServices(nodeId); }, 1000);
        });
    },

    serviceRestart: function(nodeId, serviceName) {
        var self = this;
        this.api('service_restart', [nodeId, serviceName], function(r) {
            layer.msg(r.msg || '操作完成', {icon: r.status ? 1 : 2});
            setTimeout(function() { self.loadServices(nodeId); }, 2000);
        });
    },

    serviceReload: function(nodeId, serviceName) {
        var self = this;
        this.api('service_reload', [nodeId, serviceName], function(r) {
            layer.msg(r.msg || '操作完成', {icon: r.status ? 1 : 2});
            setTimeout(function() { self.loadServices(nodeId); }, 1000);
        });
    },

    setAutoStart: function(nodeId, serviceName, enabled) {
        var self = this;
        this.api('service_set_auto_start', [nodeId, serviceName, enabled], function(r) {
            layer.msg(r.msg || '操作完成', {icon: r.status ? 1 : 2});
            setTimeout(function() { self.loadServices(nodeId); }, 500);
        });
    },

    // ==================== 主服务数据库配置 ====================
    editServiceDb: function(serviceId) {
        var self = this;
        this.api('get_installed_databases', [], function(r) {
            var dbList = r.data || r.msg || [];
            self.currentServiceId = serviceId;
            self.openServiceDbModal(serviceId, dbList);
        });
    },

    openServiceDbModal: function(serviceId, dbList) {
        var self = this;
        var html = '<div style="padding:20px;">' +
            '<div class="form-group"><label>数据库类型</label>' +
            '<select class="form-control" id="svcDbType" onchange="clusterApp.onSvcDbTypeChange()">';
        html += '<option value="">请选择</option>';
        html += '<option value="mysql">MySQL</option>';
        html += '<option value="mariadb">MariaDB</option>';
        html += '<option value="postgresql">PostgreSQL</option>';
        html += '</select></div>';

        // 已安装的数据库
        if (dbList.length > 0) {
            html += '<div style="margin-bottom:10px;"><span style="font-size:12px;color:#999;">已安装的数据库:</span> ';
            dbList.forEach(function(db) {
                html += '<span class="label label-info" style="margin-right:5px;">' + db.name + '</span>';
            });
            html += '</div>';
        }

        html += '<div class="form-group"><label>主机地址</label><input type="text" class="form-control" id="svcDbHost" value="127.0.0.1"></div>' +
            '<div class="form-group"><label>端口</label><input type="number" class="form-control" id="svcDbPort" value="3306"></div>' +
            '<div class="form-group"><label>数据库名</label><input type="text" class="form-control" id="svcDbName"></div>' +
            '<div class="form-group"><label>用户名</label><input type="text" class="form-control" id="svcDbUser"></div>' +
            '<div class="form-group"><label>密码</label><input type="password" class="form-control" id="svcDbPassword"></div>' +
            '<div class="btn-group">' +
                '<button class="btn btn-warning btn-sm" onclick="clusterApp.testSvcDbConnection()"><i class="fa fa-plug"></i> 测试连接</button>' +
                '<button class="btn btn-primary btn-sm" onclick="clusterApp.saveServiceDb(' + serviceId + ')">保存</button>' +
            '</div>' +
        '</div>';

        layer.open({
            type: 1,
            title: '<i class="fa fa-database"></i> 配置数据库',
            area: ['500px', '520px'],
            content: html
        });
    },

    onSvcDbTypeChange: function() {
        var dbType = $('#svcDbType').val();
        if (dbType === 'postgresql') {
            $('#svcDbPort').val('5432');
        } else {
            $('#svcDbPort').val('3306');
        }
    },

    saveServiceDb: function(serviceId) {
        var self = this;
        var data = {
            db_type: $('#svcDbType').val(),
            db_host: $('#svcDbHost').val(),
            db_port: parseInt($('#svcDbPort').val()),
            db_name: $('#svcDbName').val(),
            db_user: $('#svcDbUser').val(),
            db_password: $('#svcDbPassword').val()
        };
        this.api('edit_service', [Object.assign({id: serviceId}, data)], function(r) {
            if (r.status) {
                layer.closeAll();
                layer.msg('数据库配置已保存', {icon: 1});
                if (self.currentGroupId) {
                    self.loadNodes(self.currentGroupId);
                }
            } else {
                layer.msg(r.msg || '保存失败', {icon: 2});
            }
        });
    },

    testSvcDbConnection: function() {
        var data = {
            db_type: $('#svcDbType').val(),
            db_host: $('#svcDbHost').val(),
            db_port: parseInt($('#svcDbPort').val()),
            db_name: $('#svcDbName').val(),
            db_user: $('#svcDbUser').val(),
            db_password: $('#svcDbPassword').val()
        };
        this.api('test_db_connection', [data.db_type, data.db_host, data.db_port, data.db_name, data.db_user, data.db_password], function(r) {
            layer.msg(r.msg || '测试完成', {icon: r.status ? 1 : 2});
        });
    },

    // ==================== 全局主服务数据库配置 ====================
    openMainDbConfig: function() {
        var self = this;
        this.api('get_main_db_config', [], function(r) {
            var cfg = r.data || r.msg || {};
            self.renderMainDbConfig(cfg);
        });
        this.api('get_installed_databases', [], function(r) {
            var dbList = r.data || r.msg || [];
            var html = '<option value="">请选择</option>';
            dbList.forEach(function(db) {
                html += '<option value="' + db.type + '">' + db.name + ' (端口:' + db.default_port + ')</option>';
            });
            html += '<option value="mysql">MySQL</option>';
            html += '<option value="mariadb">MariaDB</option>';
            html += '<option value="postgresql">PostgreSQL</option>';
            $('#mainDbType').html(html);
        });
    },

    renderMainDbConfig: function(cfg) {
        $('#useExternalDb').prop('checked', cfg.use_external_db || false);
        $('#mainDbHost').val(cfg.main_db_host || '127.0.0.1');
        $('#mainDbPort').val(cfg.main_db_port || 3306);
        $('#mainDbName').val(cfg.main_db_name || 'mdserver_cluster');
        $('#mainDbUser').val(cfg.main_db_user || '');
        $('#mainDbPassword').val(cfg.main_db_password || '');
        $('#syncInterval').val(cfg.sync_interval || 60);
        $('#heartbeatTimeout').val(cfg.heartbeat_timeout || 30);
        this.toggleExternalDb();
        $('#mainDbModal').modal('show');
    },

    toggleExternalDb: function() {
        var checked = $('#useExternalDb').is(':checked');
        $('#externalDbConfig').toggle(checked);
    },

    onDbTypeChange: function() {
        var dbType = $('#mainDbType').val();
        if (dbType === 'postgresql') {
            $('#mainDbPort').val('5432');
        } else {
            $('#mainDbPort').val('3306');
        }
    },

    saveMainDbConfig: function() {
        var self = this;
        var data = {
            db_type: $('#mainDbType').val(),
            db_host: $('#mainDbHost').val(),
            db_port: parseInt($('#mainDbPort').val()),
            db_name: $('#mainDbName').val(),
            db_user: $('#mainDbUser').val(),
            db_password: $('#mainDbPassword').val(),
            use_external_db: $('#useExternalDb').is(':checked'),
            sync_interval: parseInt($('#syncInterval').val()) || 60,
            heartbeat_timeout: parseInt($('#heartbeatTimeout').val()) || 30
        };
        this.api('save_main_db_config', [data.db_type, data.db_host, data.db_port, data.db_name,
            data.db_user, data.db_password, data.use_external_db, data.sync_interval, data.heartbeat_timeout], function(r) {
            if (r.status) {
                layer.msg('主服务配置已保存', {icon: 1});
                $('#mainDbModal').modal('hide');
            } else {
                layer.msg(r.msg || '保存失败', {icon: 2});
            }
        });
    },

    testDbConnection: function() {
        var data = {
            db_type: $('#mainDbType').val(),
            db_host: $('#mainDbHost').val(),
            db_port: parseInt($('#mainDbPort').val()),
            db_name: $('#mainDbName').val(),
            db_user: $('#mainDbUser').val(),
            db_password: $('#mainDbPassword').val()
        };
        this.api('test_db_connection', [data.db_type, data.db_host, data.db_port, data.db_name, data.db_user, data.db_password], function(r) {
            layer.msg(r.msg || '测试完成', {icon: r.status ? 1 : 2});
        });
    },

    initExternalDb: function() {
        this.api('init_external_db', [], function(r) {
            layer.msg(r.msg || '操作完成', {icon: r.status ? 1 : 2});
        });
    },

    // ==================== 子面板设置 ====================
    openSubPanelConfig: function(serviceId, nodeId) {
        var self = this;
        this.currentServiceId = serviceId;
        this.currentNodeId = nodeId;
        $('#subPanelServiceId').val(serviceId);
        this.api('get_sub_panel_config', [serviceId], function(r) {
            var config = r.data || r.msg || {};
            if (typeof config === 'string') {
                try { config = JSON.parse(config); } catch(e) { config = {}; }
            }
            $('#subPanelConfig').val(JSON.stringify(config, null, 2));
            $('#subPanelEnv').val(JSON.stringify(config.env || {}, null, 2));
            $('#subPanelArgs').val(config.args || '');
            $('#subPanelWorkDir').val(config.work_dir || '');
            $('#subPanelLogPath').val(config.log_path || '');
            $('#subPanelModal').modal('show');
        });
    },

    saveSubPanelConfig: function() {
        var self = this;
        var serviceId = parseInt($('#subPanelServiceId').val());
        try {
            var config = JSON.parse($('#subPanelConfig').val() || '{}');
            var env = JSON.parse($('#subPanelEnv').val() || '{}');
            config.env = env;
            config.args = $('#subPanelArgs').val();
            config.work_dir = $('#subPanelWorkDir').val();
            config.log_path = $('#subPanelLogPath').val();
            
            this.api('save_sub_panel_config', [serviceId, config], function(r) {
                if (r.status) {
                    layer.msg('子面板配置已保存', {icon: 1});
                    $('#subPanelModal').modal('hide');
                } else {
                    layer.msg(r.msg || '保存失败', {icon: 2});
                }
            });
        } catch(e) {
            layer.msg('JSON格式错误: ' + e.message, {icon: 2});
        }
    },

    syncSubPanelConfig: function() {
        var self = this;
        var serviceId = parseInt($('#subPanelServiceId').val());
        var nodeId = this.currentNodeId;
        this.api('sync_sub_panel_config', [nodeId, serviceId], function(r) {
            layer.msg(r.msg || '同步完成', {icon: r.status ? 1 : 2});
        });
    },

    renderContentPlaceholder: function() {
        $('#clusterContent').html(
            '<div class="content-placeholder">' +
                '<i class="fa fa-server" style="font-size:48px;color:#ccc;"></i>' +
                '<p>请选择分组或添加节点</p>' +
            '</div>'
        );
    }
};