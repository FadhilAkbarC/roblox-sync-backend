-- ========================================
-- ROBLOX STUDIO SYNC PLUGIN v2.0
-- Production-Grade Real-Time Sync
-- ========================================

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local RunService = game:GetService("RunService")

-- ========================================
-- CONFIGURATION
-- ========================================

local CONFIG = {
    -- Backend URL (GANTI DENGAN URL RAILWAY ANDA!)
    BACKEND_URL = "https://roblox-sync-backend-production.up.railway.app/",
    
    -- Sync interval in seconds (increased to reduce spam)
    SYNC_INTERVAL = 10,
    
    -- Maximum hierarchy depth (prevent stack overflow)
    MAX_DEPTH = 20,
    
    -- Enable debug logging
    DEBUG = true,
    
    -- Retry configuration
    MAX_RETRIES = 3,
    RETRY_DELAY = 1
}

-- ========================================
-- STATE
-- ========================================

local state = {
    isSyncing = false,
    lastSyncTime = 0,
    syncCount = 0,
    errorCount = 0,
    isPluginActive = false
}

-- ========================================
-- UI COMPONENTS
-- ========================================

-- Create toolbar
local toolbar = plugin:CreateToolbar("Studio Sync")

-- Create toggle button
local toggleButton = toolbar:CreateButton(
    "Sync Explorer",
    "Toggle real-time sync to web explorer",
    "rbxasset://textures/ui/Settings/MenuBarIcons/GameSettingsTab.png"
)

-- ========================================
-- ICON MAPPING
-- ========================================

local ICON_MAP = {
    -- Services
    ["Workspace"] = "workspace",
    ["Lighting"] = "lighting",
    ["Players"] = "players",
    ["ReplicatedStorage"] = "repStorage",
    ["ReplicatedFirst"] = "repFirst",
    ["ServerScriptService"] = "svrScript",
    ["ServerStorage"] = "svrStorage",
    ["StarterGui"] = "folder",
    ["StarterPack"] = "folder",
    ["SoundService"] = "sound",
    ["Chat"] = "chat",
    
    -- Scripts
    ["Script"] = "script",
    ["LocalScript"] = "local",
    ["ModuleScript"] = "module",
    
    -- UI
    ["ScreenGui"] = "screenGui",
    ["Frame"] = "frame",
    ["TextLabel"] = "frame",
    ["TextButton"] = "frame",
    ["ImageLabel"] = "frame",
    
    -- Objects
    ["Part"] = "part",
    ["MeshPart"] = "part",
    ["UnionOperation"] = "part",
    ["Model"] = "model",
    ["Folder"] = "folder",
    ["Sound"] = "sound",
    ["ParticleEmitter"] = "part",
    ["Beam"] = "part",
    ["Attachment"] = "part"
}

-- ========================================
-- UTILITY FUNCTIONS
-- ========================================

local function log(message, level)
    level = level or "INFO"
    local timestamp = os.date("%H:%M:%S")
    local prefix = "[Sync]"
    
    if level == "ERROR" then
        warn(string.format("%s [%s] ❌ %s", prefix, timestamp, message))
    elseif level == "SUCCESS" then
        print(string.format("%s [%s] ✓ %s", prefix, timestamp, message))
    elseif level == "DEBUG" and CONFIG.DEBUG then
        print(string.format("%s [%s] 🔍 %s", prefix, timestamp, message))
    else
        print(string.format("%s [%s] %s", prefix, timestamp, message))
    end
end

local function getIconType(className)
    return ICON_MAP[className] or "part"
end

local function isScriptType(className)
    return className == "Script" 
        or className == "LocalScript" 
        or className == "ModuleScript"
end

-- ========================================
-- HIERARCHY EXTRACTION
-- ========================================

local function extractHierarchy(instance, depth)
    -- Prevent infinite recursion
    depth = depth or 0
    if depth > CONFIG.MAX_DEPTH then
        log(string.format("Max depth reached at %s", instance.Name), "DEBUG")
        return nil
    end
    
    -- Skip certain instances
    if instance.ClassName == "Camera" and instance.Name == "Camera" then
        -- Skip workspace camera
        return nil
    end
    
    -- Build node data
    local node = {
        n = instance.Name,
        c = instance.ClassName,
        i = getIconType(instance.ClassName),
        isScript = isScriptType(instance.ClassName),
        children = {}
    }
    
    -- Process children
    local success, children = pcall(function()
        return instance:GetChildren()
    end)
    
    if success then
        for _, child in ipairs(children) do
            local childNode = extractHierarchy(child, depth + 1)
            if childNode then
                table.insert(node.children, childNode)
            end
        end
    end
    
    -- Remove empty children array
    if #node.children == 0 then
        node.children = nil
    end
    
    return node
end

-- ========================================
-- SCRIPT EXTRACTION
-- ========================================

local function extractScriptSource(scriptInstance)
    local success, source = pcall(function()
        if scriptInstance:IsA("LuaSourceContainer") then
            return scriptInstance.Source
        end
        return nil
    end)
    
    if success and source then
        return source
    else
        return "-- [Error: Cannot read source code]"
    end
end

local function buildScriptsDatabase(rootInstance)
    local scripts = {}
    
    local function traverse(instance)
        -- Extract script source
        if instance:IsA("LuaSourceContainer") then
            local source = extractScriptSource(instance)
            if source then
                scripts[instance.Name] = source
            end
        end
        
        -- Traverse children
        local success, children = pcall(function()
            return instance:GetChildren()
        end)
        
        if success then
            for _, child in ipairs(children) do
                traverse(child)
            end
        end
    end
    
    traverse(rootInstance)
    return scripts
end

-- ========================================
-- DATA SYNC FUNCTION
-- ========================================

local function syncToBackend()
    if not state.isSyncing then return end
    
    local startTime = tick()
    
    local success, result = pcall(function()
        -- Root containers to sync
        local rootContainers = {
            game.Workspace,
            game.Players,
            game.Lighting,
            game.ReplicatedFirst,
            game.ReplicatedStorage,
            game.ServerScriptService,
            game.ServerStorage,
            game.StarterGui,
            game.StarterPack,
            game.SoundService,
            game.Chat
        }
        
        -- Extract hierarchy
        local hierarchy = {}
        for _, container in ipairs(rootContainers) do
            if container then
                local node = extractHierarchy(container)
                if node then
                    table.insert(hierarchy, node)
                end
            end
        end
        
        -- Extract scripts
        local allScripts = {}
        for _, container in ipairs(rootContainers) do
            if container then
                local containerScripts = buildScriptsDatabase(container)
                for name, source in pairs(containerScripts) do
                    -- Handle duplicate names
                    local uniqueName = name
                    local counter = 1
                    while allScripts[uniqueName] do
                        uniqueName = string.format("%s_%d", name, counter)
                        counter = counter + 1
                    end
                    allScripts[uniqueName] = source
                end
            end
        end
        
        -- Count objects
        local function countObjects(nodes)
            local count = 0
            for _, node in ipairs(nodes) do
                count = count + 1
                if node.children then
                    count = count + countObjects(node.children)
                end
            end
            return count
        end
        
        local objectCount = countObjects(hierarchy)
        local scriptCount = 0
        for _ in pairs(allScripts) do
            scriptCount = scriptCount + 1
        end
        
        -- Build payload
        local payload = {
            hierarchy = hierarchy,
            scripts = allScripts,
            timestamp = os.time() * 1000,  -- milliseconds
            metadata = {
                placeName = game.Name or "Untitled",
                placeId = game.PlaceId or 0,
                objectCount = objectCount,
                scriptCount = scriptCount,
                studioVersion = version()
            }
        }
        
        -- Encode JSON
        local jsonPayload = HttpService:JSONEncode(payload)
        
        -- Send HTTP request to the sync endpoint
        local response = HttpService:PostAsync(
            CONFIG.BACKEND_URL .. 'api/sync',
            jsonPayload,
            Enum.HttpContentType.ApplicationJson,
            false
        )
        
        -- Parse response
        local responseData = HttpService:JSONDecode(response)
        
        if responseData.success then
            state.lastSyncTime = os.time()
            state.syncCount = state.syncCount + 1
            
            local elapsed = math.floor((tick() - startTime) * 1000)
            
            log(string.format(
                "Synced %d objects, %d scripts to %d clients in %dms",
                objectCount,
                scriptCount,
                responseData.clientsNotified or 0,
                elapsed
            ), "SUCCESS")
            
            return true
        else
            log("Server responded with error", "ERROR")
            return false
        end
    end)
    
    if not success then
        state.errorCount = state.errorCount + 1
        log(string.format("Sync failed: %s", tostring(result)), "ERROR")
        
        -- Retry logic
        if state.errorCount <= CONFIG.MAX_RETRIES then
            log(string.format("Retrying in %ds... (attempt %d/%d)", 
                CONFIG.RETRY_DELAY, 
                state.errorCount, 
                CONFIG.MAX_RETRIES), "INFO")
            wait(CONFIG.RETRY_DELAY)
            syncToBackend()
        else
            log("Max retries reached. Stopping sync.", "ERROR")
            stopSync()
        end
    else
        -- Reset error count on success
        state.errorCount = 0
    end
end

-- ========================================
-- SYNC CONTROL
-- ========================================

local syncThread = nil

function startSync()
    if state.isSyncing then return end
    
    state.isSyncing = true
    state.isPluginActive = true
    toggleButton:SetActive(true)
    
    log("🟢 Real-time sync started", "SUCCESS")
    log(string.format("Backend: %s", CONFIG.BACKEND_URL), "INFO")
    log(string.format("Interval: %ds", CONFIG.SYNC_INTERVAL), "INFO")
    
    -- Initial sync
    syncToBackend()
    
    -- Start sync loop
    syncThread = coroutine.create(function()
        while state.isSyncing do
            wait(CONFIG.SYNC_INTERVAL)
            if state.isSyncing then
                syncToBackend()
            end
        end
    end)
    
    coroutine.resume(syncThread)
    
    -- Event-based syncing disabled to reduce spam from folder open/close
    -- Sync now happens only on the interval timer (SYNC_INTERVAL)
end

function stopSync()
    if not state.isSyncing then return end
    
    state.isSyncing = false
    state.isPluginActive = false
    toggleButton:SetActive(false)
    
    log("🔴 Real-time sync stopped", "INFO")
    log(string.format("Total syncs: %d", state.syncCount), "INFO")
end

-- ========================================
-- BUTTON HANDLER
-- ========================================

toggleButton.Click:Connect(function()
    -- Check if HttpService is enabled
    local httpEnabled = HttpService.HttpEnabled
    
    if not httpEnabled then
        warn("========================================")
        warn("❌ HTTP SERVICE IS DISABLED!")
        warn("========================================")
        warn("Please enable HTTP Requests:")
        warn("1. Home → Game Settings")
        warn("2. Security tab")
        warn("3. ✅ Allow HTTP Requests")
        warn("4. Click Save")
        warn("========================================")
        
        -- Try to enable automatically (may not work in all cases)
        pcall(function()
            HttpService.HttpEnabled = true
            log("Attempted to enable HttpService", "INFO")
        end)
        
        return
    end
    
    -- Toggle sync
    if state.isSyncing then
        stopSync()
    else
        startSync()
    end
end)

-- ========================================
-- CLEANUP
-- ========================================

plugin.Unloading:Connect(function()
    stopSync()
    log("Plugin unloaded", "INFO")
end)

-- ========================================
-- INITIALIZATION
-- ========================================

log("========================================")
log("✅ Roblox Studio Sync Plugin v2.0 Loaded!")
log("========================================")
log(string.format("Backend URL: %s", CONFIG.BACKEND_URL))
log(string.format("Sync Interval: %ds", CONFIG.SYNC_INTERVAL))
log("Click 'Sync Explorer' button to start")
log("========================================")

-- Check HttpService status
if not HttpService.HttpEnabled then
    warn("⚠️  WARNING: HttpService is currently disabled!")
    warn("Enable it in Game Settings → Security")
end