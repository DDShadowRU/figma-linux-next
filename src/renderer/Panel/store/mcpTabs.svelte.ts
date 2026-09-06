let list = $state.raw<Types.McpTabFront[]>([]);

export const mcpTabs = {
  get value() {
    return list;
  },
  set(value: Types.McpTabFront[]) {
    list = value;
  },
};
