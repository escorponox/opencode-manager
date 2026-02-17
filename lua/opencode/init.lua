local M = {}

-- Manager configuration
local MANAGER_URL = "http://localhost:4095"

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
function M.setup()
	-- Focus TUI
	vim.keymap.set("n", ",eo", function()
		M.focus_tui()
	end, { silent = true, desc = "OpenCode focus TUI" })

	-- Custom prompt
	vim.keymap.set("n", ",ee", function()
		M.prompt_input()
	end, { silent = true, desc = "OpenCode prompt" })
end

return M
