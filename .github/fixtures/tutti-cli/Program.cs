using System;

internal static class Program
{
    private const string Config = "{\"configurable\":false,\"currentValue\":\"fixture-model\",\"defaultValue\":\"fixture-model\",\"options\":[{\"id\":\"fixture-model\",\"value\":\"fixture-model\",\"label\":\"Fixture Model\"}]}";

    public static int Main(string[] args)
    {
        var command = string.Join(" ", args);
        if (command.Contains("agent list"))
        {
            Console.Write("{\"schemaVersion\":1,\"defaultAgentTargetId\":\"fixture:codex\",\"agents\":[{\"id\":\"fixture:codex\",\"provider\":\"codex\",\"name\":\"Fixture Codex\",\"availability\":{\"status\":\"available\",\"reasonCode\":\"\",\"detail\":\"\"}}]}");
            return 0;
        }
        if (command.Contains("agent composer-options"))
        {
            Console.Write("{\"schemaVersion\":2,\"agentTargetId\":\"fixture:codex\",\"providerId\":\"codex\",\"effectiveSettings\":{},\"modelConfig\":" + Config + ",\"permissionConfig\":{\"configurable\":false,\"defaultValue\":\"\",\"modes\":[]},\"reasoningConfig\":" + Config + ",\"speedConfig\":" + Config + "}");
            return 0;
        }
        Console.Error.Write("unsupported fixture command: " + command);
        return 2;
    }
}
