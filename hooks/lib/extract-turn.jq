# =============================================================================
# AgentsLeak - Extract Claude's mid-turn notes from a Claude Code transcript
# =============================================================================
# Run with -n; reads transcript lines (JSONL) as `inputs`, starting at the
# turn's prompt line (stop.sh finds it by promptId), or the tail of the file.
#
#   jq -n -c --arg pid PROMPT_ID --arg reply REPLY --argjson note_max 4000 \
#      -f extract-turn.jq < transcript-tail.jsonl
#
# Output: {"notes": [{"text", "before_tool_use_id", "timestamp"}], "truncated"}
#
# A note is text Claude wrote during the turn. before_tool_use_id is the
# tool call it introduces (the next tool_use in the transcript), or null for
# text after the last tool call. The final reply comes from the Stop payload
# (last_assistant_message), so text equal to it is dropped here. Thinking,
# subagent (sidechain) entries and non-message lines are ignored. Lines are
# reduced to the fields needed as they stream in, so huge tool outputs in the
# transcript are never held in memory.
# =============================================================================

# A user entry that starts a turn: typed text, not a tool result.
def is_prompt:
  .type == "user"
  and (.message.content | if type == "string" then true
       else (type == "array" and all(.[]; .type != "tool_result")) end);

def cap($n):
  if length > $n then {text: .[0:$n], cut: true} else {text: ., cut: false} end;

[ inputs
  | select(.isSidechain != true)
  | if .type == "assistant" then
      {kind: "assistant", ts: .timestamp,
       blocks: [.message.content[]?
                | select(.type == "text" or .type == "tool_use")
                | {type, text, id}]}
    elif .type == "user" then
      {kind: "user", prompt_id: (.promptId // null), is_prompt: is_prompt}
    else empty end
]
# With a prompt id, the first entry is that turn's prompt: start after it.
# Without one (older Claude Code), start after the last prompt in the input.
| (if $pid != "" then .[1:]
   else ((map(.is_prompt) | rindex(true)) as $i
         | if $i == null then . else .[$i + 1:] end) end)
| reduce .[] as $e ({notes: [], pending: [], done: false};
    if .done then .
    elif $e.kind == "user" then
      # A new prompt (different turn) ends this one; tool results don't.
      if $e.is_prompt and ($pid == "" or $e.prompt_id != $pid) then .done = true
      else . end
    else
      reduce $e.blocks[] as $b (.;
        if $b.type == "text" and (($b.text // "") | test("\\S")) then
          .pending += [{text: $b.text, timestamp: $e.ts}]
        elif $b.type == "tool_use" then
          .notes += (.pending | map(. + {before_tool_use_id: $b.id}))
          | .pending = []
        else . end)
    end)
| (.notes + (.pending | map(. + {before_tool_use_id: null})))
| map(select(.text != $reply))
| map(. as $n | ($n.text | cap($note_max)) as $c
      | {text: $c.text, before_tool_use_id: $n.before_tool_use_id,
         timestamp: $n.timestamp, cut: $c.cut})
| {notes: map(del(.cut)), truncated: any(.[]; .cut)}
