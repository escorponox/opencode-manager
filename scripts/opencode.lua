local M = {}

-- Manager configuration
local MANAGER_URL = "http://localhost:4095"

-- SSE connection state: active_sse_connections[encoded_path] = { job, last_event_time, parser, last_notify_time }
local active_sse_connections = {}

-- Global idle check timer
local idle_check_timer = nil

-- Configuration (set via M.setup)
M.config = {
	sse_enabled = true,
	sse_idle_timeout = 300, -- 5 minutes
	sse_debug = false,
	sse_debounce_interval = 2, -- 2 seconds for message.updated
}

-- Helper to encode project path for URL (base64url)
local function encode_path(path)
	-- Use vim.base64 if available (Neovim 0.10+), otherwise use base64 command
	local encoded
	if vim.base64 and vim.base64.encode then
		encoded = vim.base64.encode(path)
	else
		-- Fallback to shell command
		local result = vim.fn.system("echo -n '" .. path:gsub("'", "'\\''") .. "' | base64")
		encoded = vim.fn.trim(result)
	end
	-- Convert to base64url (replace + with -, / with _, remove padding)
	encoded = encoded:gsub("+", "-"):gsub("/", "_"):gsub("=", ""):gsub("\n", "")
	return encoded
end

-- Helper to make GET requests
local function api_get(endpoint)
	local cmd = string.format("curl -s '%s%s'", MANAGER_URL, endpoint)
	local result = vim.fn.system(cmd)
	if vim.v.shell_error ~= 0 then
		return nil, "Request failed"
	end
	local ok, data = pcall(vim.fn.json_decode, result)
	if not ok then
		return nil, "JSON decode failed"
	end
	return data
end

-- Helper to make POST requests with JSON data
local function api_post(endpoint, data)
	local json_data = data and vim.fn.json_encode(data) or "{}"
	-- Escape single quotes in JSON
	json_data = json_data:gsub("'", "'\\''")
	local cmd = string.format(
		"curl -s -X POST -H 'Content-Type: application/json' -d '%s' '%s%s'",
		json_data,
		MANAGER_URL,
		endpoint
	)
	local result = vim.fn.system(cmd)
	if vim.v.shell_error ~= 0 then
		return nil, "Request failed"
	end
	if result == "" or result == nil then
		return {}
	end
	local ok, decoded = pcall(vim.fn.json_decode, result)
	if not ok then
		return nil, "JSON decode failed"
	end
	return decoded
end

-- Check if manager is running
function M.is_manager_running()
	local health = api_get("/health")
	return health and health.healthy == true
end

-- Get current project path
local function get_project_path()
	return vim.fn.getcwd()
end

-- Get current file context
local function get_context()
	local file = vim.fn.fnamemodify(vim.fn.expand("%"), ":.")
	local cursor = vim.api.nvim_win_get_cursor(0)
	return {
		file = file,
		line = cursor[1],
		col = cursor[2] + 1,
	}
end

-- SSE Event Processing --------------------------------------------------
--------------------------------------------------------------------------

-- Debug logging helper
local function sse_debug(msg)
	if M.config.sse_debug then
		vim.schedule(function()
			vim.notify("[SSE Debug] " .. msg, vim.log.levels.DEBUG)
		end)
	end
end

-- Process a complete SSE event
local function process_sse_event(encoded, event_type, data_lines)
	vim.schedule(function()
		local data = table.concat(data_lines, "\n")

		sse_debug("Event: " .. event_type .. " | Data: " .. data)

		-- Try to parse JSON data
		local ok, json = pcall(vim.fn.json_decode, data)

		if not ok then
			-- Non-JSON event, just show event type
			vim.notify("OpenCode: " .. event_type, vim.log.levels.INFO)
			return
		end

		-- Get connection for debouncing
		local conn = active_sse_connections[encoded]
		if not conn then
			return
		end

		local now = os.time()

		-- Format notification based on event type
		if event_type == "message.created" then
			vim.notify("OpenCode: New message", vim.log.levels.INFO)
			conn.last_notify_time = now
		elseif event_type == "message.updated" then
			-- Debounce: only notify if enough time has passed
			local last_notify = conn.last_notify_time or 0
			if now - last_notify >= M.config.sse_debounce_interval then
				vim.notify("OpenCode: Message updated", vim.log.levels.INFO)
				conn.last_notify_time = now
			end
		elseif event_type == "error" then
			local msg = json.message or json.error or "Unknown error"
			vim.notify("OpenCode error: " .. msg, vim.log.levels.ERROR)
			conn.last_notify_time = now
		else
			-- Generic event notification
			vim.notify("OpenCode: " .. event_type, vim.log.levels.INFO)
			conn.last_notify_time = now
		end
	end)
end

-- Parse SSE line and update parser state
local function parse_sse_line(encoded, parser, line)
	if not line then
		return
	end

	-- Match "event: <type>"
	local event_match = line:match("^event:%s*(.+)")
	if event_match then
		parser.current_event = event_match
		return
	end

	-- Match "data: <json>"
	local data_match = line:match("^data:%s*(.+)")
	if data_match then
		table.insert(parser.current_data, data_match)
		return
	end

	-- Empty line signals end of event
	if line == "" then
		if parser.current_event and #parser.current_data > 0 then
			process_sse_event(encoded, parser.current_event, parser.current_data)
		end
		-- Reset parser state
		parser.current_event = nil
		parser.current_data = {}
		return
	end

	-- Ignore other lines (comments, etc.)
end

-- SSE Connection Management ---------------------------------------------
--------------------------------------------------------------------------

-- Start SSE connection for a project
local function start_sse(encoded)
	-- Check if already connected
	if active_sse_connections[encoded] then
		sse_debug("SSE already connected for project")
		return
	end

	local ok, curl = pcall(require, "plenary.curl")
	if not ok then
		vim.schedule(function()
			vim.notify("plenary.nvim not found, SSE disabled", vim.log.levels.WARN)
		end)
		return
	end

	local url = MANAGER_URL .. "/project/" .. encoded .. "/events"

	sse_debug("Starting SSE connection to " .. url)

	-- Create parser state for this connection
	local parser = {
		current_event = nil,
		current_data = {},
	}

	-- Start SSE stream with plenary.curl
	local job = curl.get(url, {
		-- -N = no buffering, Accept = text/event-stream
		raw = { "-N", "-H", "Accept: text/event-stream" },
		stream = function(err, line, _)
			if err then
				vim.schedule(function()
					vim.notify("SSE error: " .. tostring(err), vim.log.levels.ERROR)
				end)
				return
			end

			if line then
				parse_sse_line(encoded, parser, line)

				-- Update last activity time
				local conn = active_sse_connections[encoded]
				if conn then
					conn.last_event_time = os.time()
				end
			end
		end,
		callback = function(result)
			-- Connection closed
			vim.schedule(function()
				if result and result.exit ~= 0 then
					sse_debug("SSE connection closed with exit code: " .. result.exit)
				else
					sse_debug("SSE connection closed")
				end
				active_sse_connections[encoded] = nil
			end)
		end,
		on_error = function(err)
			vim.schedule(function()
				local msg = err.message or err.stderr or "Unknown error"
				vim.notify("SSE connection failed: " .. msg, vim.log.levels.ERROR)
				active_sse_connections[encoded] = nil
			end)
		end,
	})

	-- Store connection info
	active_sse_connections[encoded] = {
		job = job,
		last_event_time = os.time(),
		last_notify_time = 0,
		parser = parser,
	}

	sse_debug("SSE connection started")
end

-- Stop SSE connection for a project
local function stop_sse(encoded)
	local conn = active_sse_connections[encoded]
	if not conn then
		return
	end

	sse_debug("Stopping SSE connection")

	-- Shutdown the job
	if conn.job and conn.job.shutdown then
		conn.job:shutdown()
	end

	active_sse_connections[encoded] = nil
end

-- Ensure SSE connection is active (auto-connect)
local function ensure_sse(encoded)
	if not M.config.sse_enabled then
		return
	end

	-- Check if already connected
	if active_sse_connections[encoded] then
		-- Update last activity time
		active_sse_connections[encoded].last_event_time = os.time()
		return
	end

	-- Start new connection
	start_sse(encoded)
end

-- Check for idle SSE connections and close them
local function check_sse_idle_timeout()
	local now = os.time()
	local timeout = M.config.sse_idle_timeout

	for encoded, conn in pairs(active_sse_connections) do
		if now - conn.last_event_time > timeout then
			sse_debug("SSE idle timeout for project, disconnecting")
			vim.schedule(function()
				vim.notify("OpenCode: SSE idle timeout, disconnecting", vim.log.levels.INFO)
			end)
			stop_sse(encoded)
		end
	end
end

-- Cleanup all SSE connections
local function cleanup_all_sse()
	sse_debug("Cleaning up all SSE connections")
	for encoded, _ in pairs(active_sse_connections) do
		stop_sse(encoded)
	end
end

-- Start the idle timeout check timer
local function start_idle_check_timer()
	if idle_check_timer then
		return
	end

	idle_check_timer = vim.loop.new_timer()
	-- Check every 60 seconds
	idle_check_timer:start(
		60000,
		60000,
		vim.schedule_wrap(function()
			check_sse_idle_timeout()
		end)
	)

	sse_debug("Idle check timer started")
end

-- Ensure server is running for current project
function M.ensure_server()
	local project_path = get_project_path()
	local encoded = encode_path(project_path)
	return api_post("/project/" .. encoded .. "/ensure")
end

-- Send prompt to OpenCode
function M.prompt(text, include_context)
	if not M.is_manager_running() then
		vim.notify("OpenCode Manager is not running", vim.log.levels.ERROR)
		return
	end

	local project_path = get_project_path()
	local encoded = encode_path(project_path)

	-- Ensure SSE connection is active for this project
	ensure_sse(encoded)

	local body = { text = text }
	if include_context ~= false then
		local ctx = get_context()
		body.file = ctx.file
		body.line = ctx.line
		body.col = ctx.col
	end

	local result, err = api_post("/project/" .. encoded .. "/prompt", body)
	if err then
		vim.notify("Failed to send prompt: " .. err, vim.log.levels.ERROR)
		return
	end

	if result and result.error then
		vim.notify("OpenCode error: " .. result.error, vim.log.levels.ERROR)
		return
	end

	vim.notify("Prompt sent to OpenCode", vim.log.levels.INFO)
	return result
end

-- Focus TUI in tmux
function M.focus_tui()
	if not M.is_manager_running() then
		vim.notify("OpenCode Manager is not running", vim.log.levels.ERROR)
		return
	end

	local project_path = get_project_path()
	local encoded = encode_path(project_path)

	-- Ensure SSE connection is active for this project
	ensure_sse(encoded)

	-- Check if project has TUI
	local status = api_get("/project/" .. encoded)

	if not status or status.error then
		-- No server, start one and attach TUI
		vim.notify("Starting OpenCode server...", vim.log.levels.INFO)
		local result = api_post("/project/" .. encoded .. "/attach-tui-neovim")
		if not result or not result.success then
			vim.notify("Failed to attach TUI: " .. (result and result.error or "unknown error"), vim.log.levels.ERROR)
			return
		end
	elseif not status.hasTUI then
		-- Server running but no TUI
		vim.notify("Attaching TUI...", vim.log.levels.INFO)
		local result = api_post("/project/" .. encoded .. "/attach-tui-neovim")
		if not result or not result.success then
			vim.notify("Failed to attach TUI: " .. (result and result.error or "unknown error"), vim.log.levels.ERROR)
			return
		end
	else
		-- TUI exists, focus it
		api_post("/project/" .. encoded .. "/focus-tui")
	end

	-- Focus Ghostty via Hammerspoon
	local result = vim.fn.system("hs -c 'focusGhostty()'")
	if vim.v.shell_error ~= 0 then
		vim.notify("Failed to focus Ghostty via Hammerspoon: " .. vim.fn.trim(result), vim.log.levels.ERROR)
		return
	end
end

-- Prompt with input
function M.prompt_input()
	if not M.is_manager_running() then
		vim.notify("OpenCode Manager is not running", vim.log.levels.ERROR)
		return
	end

	Snacks.input.input({
		prompt = "OpenCode",
	}, function(user_input)
		if user_input == nil or user_input == "" then
			return
		end
		M.prompt(user_input, true)
	end)
end

-- Setup keymaps and autocommands
function M.setup(opts)
	opts = opts or {}

	-- Merge user config with defaults
	M.config = vim.tbl_deep_extend("force", M.config, opts)

	-- Focus TUI
	vim.keymap.set("n", ",eo", function()
		M.focus_tui()
	end, { silent = true, desc = "OpenCode focus TUI" })

	-- Custom prompt
	vim.keymap.set("n", ",ep", function()
		M.prompt_input()
	end, { silent = true, desc = "OpenCode prompt" })

	-- Cleanup SSE connections on Neovim exit
	vim.api.nvim_create_autocmd("VimLeavePre", {
		callback = function()
			cleanup_all_sse()
		end,
		desc = "Cleanup OpenCode SSE connections",
	})

	-- Start idle timeout checker if SSE is enabled
	if M.config.sse_enabled then
		start_idle_check_timer()
	end
end

return M
