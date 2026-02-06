#include <chrono>
#include <fstream>
#include <iostream>
#include <map>
#include <omp.h>
#include <queue>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <vector>

static int DEFAULT_MC_ROUNDS = 1000;

struct Edge {
  int to;
  double probability;
};

class Graph {
public:
  std::map<std::string, int> id_map;
  std::vector<std::string> reverse_id_map;
  std::vector<std::vector<Edge>> adj;
  std::vector<double> node_values;
  std::vector<char> has_value;

  int get_internal_id(const std::string &gexf_id) {
    auto it = id_map.find(gexf_id);
    if (it == id_map.end()) {
      int new_id = reverse_id_map.size();
      id_map[gexf_id] = new_id;
      reverse_id_map.push_back(gexf_id);
      adj.resize(new_id + 1);
      node_values.resize(new_id + 1, 0.0);
      has_value.resize(new_id + 1, 0);
      return new_id;
    }
    return it->second;
  }

  void add_edge(const std::string &src, const std::string &target,
                double prob) {
    int u = get_internal_id(src);
    int v = get_internal_id(target);
    adj[u].push_back({v, prob});
  }

  void set_node_value(const std::string &gexf_id, double val) {
    int u = get_internal_id(gexf_id);
    node_values[u] = val;
    has_value[u] = 1;
  }

  int num_nodes() const { return (int)reverse_id_map.size(); }
};

// please dont judge
class GEXFParser {
public:
  static Graph parse(const std::string &filename,
                     const std::string &target_attr_name) {
    Graph g;
    std::ifstream file(filename);
    if (!file.is_open())
      throw std::runtime_error("Cannot open file");

    std::ostringstream ss;
    ss << file.rdbuf();
    std::string content = ss.str();

    auto get_xml_attr = [&](const std::string &tag,
                            const std::string &attr) -> std::string {
      std::string needle = attr + "=\"";
      size_t start = tag.find(needle);
      if (start == std::string::npos)
        return "";
      start += needle.length();
      size_t end = tag.find('"', start);
      if (end == std::string::npos)
        return "";
      return tag.substr(start, end - start);
    };

    std::string target_attr_id;
    size_t pos = 0;
    while (true) {
      size_t attr_pos = content.find("<attribute", pos);
      if (attr_pos == std::string::npos)
        break;
      size_t end_pos = content.find('>', attr_pos);
      if (end_pos == std::string::npos)
        break;
      std::string tag = content.substr(attr_pos, end_pos - attr_pos + 1);
      std::string title = get_xml_attr(tag, "title");
      if (title == target_attr_name) {
        target_attr_id = get_xml_attr(tag, "id");
        std::cerr << "Found Attribute ID for '" << title
                  << "': " << target_attr_id << std::endl;
        break;
      }
      pos = end_pos + 1;
    }

    if (target_attr_id.empty()) {
      std::cerr << "Warning: Attribute '" << target_attr_name
                << "' not found in GEXF definitions." << std::endl;
    }

    pos = 0;
    while (true) {
      size_t node_pos = content.find("<node", pos);
      if (node_pos == std::string::npos)
        break;
      size_t node_tag_end = content.find('>', node_pos);
      if (node_tag_end == std::string::npos)
        break;
      bool self_closing = false;
      if (content[node_tag_end - 1] == '/')
        self_closing = true;

      size_t node_block_end = node_tag_end;
      if (!self_closing) {
        size_t close_pos = content.find("</node>", node_tag_end + 1);
        if (close_pos == std::string::npos)
          break;
        node_block_end = close_pos + 7;
      }

      std::string node_block =
          content.substr(node_pos, node_block_end - node_pos);
      std::string node_id =
          get_xml_attr(node_block.substr(0, node_tag_end - node_pos + 1), "id");
      if (!node_id.empty()) {
        int u = g.get_internal_id(node_id);
        size_t p = 0;
        while (true) {
          size_t av = node_block.find("<attvalue", p);
          if (av == std::string::npos)
            break;
          size_t av_end = node_block.find('>', av);
          if (av_end == std::string::npos)
            break;
          std::string av_tag = node_block.substr(av, av_end - av + 1);
          std::string for_id = get_xml_attr(av_tag, "for");
          if (!target_attr_id.empty() && for_id == target_attr_id) {
            std::string val_str = get_xml_attr(av_tag, "value");
            if (!val_str.empty()) {
              try {
                double val = std::stod(val_str);
                g.set_node_value(node_id, val);
              } catch (...) {
              }
            }
          }
          p = av_end + 1;
        }
      }

      pos = node_block_end;
    }

    pos = 0;
    while (true) {
      size_t edge_pos = content.find("<edge", pos);
      if (edge_pos == std::string::npos)
        break;
      size_t edge_end = content.find('>', edge_pos);
      if (edge_end == std::string::npos)
        break;
      std::string tag = content.substr(edge_pos, edge_end - edge_pos + 1);
      std::string s = get_xml_attr(tag, "source");
      std::string t = get_xml_attr(tag, "target");
      std::string w_str = get_xml_attr(tag, "weight");

      double prob = 0.1;
      if (!w_str.empty()) {
        try {
          prob = std::stod(w_str);
        } catch (...) {
        }
      }

      if (!s.empty() && !t.empty()) {
        g.add_edge(s, t, prob);
      }
      pos = edge_end + 1;
    }

    return g;
  }
};

double run_weighted_simulation_token(const Graph &g,
                                     const std::vector<int> &seed_list,
                                     std::mt19937 &rng,
                                     std::vector<unsigned int> &last_seen,
                                     int seen_token) {
  int n = g.num_nodes();
  std::deque<int> q;
  double total_value = 0.0;

  for (int s : seed_list) {
    if (last_seen[s] != seen_token) {
      last_seen[s] = seen_token;
      q.push_back(s);
      total_value += g.node_values[s];
    }
  }

  std::uniform_real_distribution<double> dist(0.0, 1.0);

  while (!q.empty()) {
    int u = q.front();
    q.pop_front();
    for (const auto &edge : g.adj[u]) {
      int v = edge.to;
      if (last_seen[v] != seen_token) {
        double r = dist(rng);
        if (r <= edge.probability) {
          last_seen[v] = seen_token;
          total_value += g.node_values[v];
          q.push_back(v);
        }
      }
    }
  }
  return total_value;
}

double estimate_weighted_spread(const Graph &g,
                                const std::vector<int> &seed_list,
                                int mc_rounds, std::mt19937 &rng) {
  double total_spread = 0.0;
  int n = g.num_nodes();
  std::vector<unsigned int> last_seen(n, 0u);
  unsigned int token = 1u;

  for (int i = 0; i < mc_rounds; ++i) {
    if (++token == 0u) {
      token = 1;
      std::fill(last_seen.begin(), last_seen.end(), 0u);
    }
    total_spread +=
        run_weighted_simulation_token(g, seed_list, rng, last_seen, token);
  }
  return total_spread / double(mc_rounds);
}

struct NodeGain {
  int node_id;
  double marginal_gain;
  int iteration_computed;

  bool operator<(const NodeGain &other) const {
    if (marginal_gain == other.marginal_gain)
      return node_id > other.node_id;
    return marginal_gain < other.marginal_gain;
  }
};

std::set<int> celf_weighted_influence(const Graph &g, int k, int mc_rounds) {
  std::set<int> seeds;
  std::priority_queue<NodeGain> pq;

  int n = g.num_nodes();
  std::cout << "Initializing CELF (calculating base weighted influence for "
            << n << " nodes)..." << std::endl;

#pragma omp parallel
  {
    std::priority_queue<NodeGain> local_pq;

    std::random_device rd;
    unsigned int tid = (unsigned)omp_get_thread_num();
    unsigned int tcount = (unsigned)omp_get_num_threads();
    std::seed_seq seq{rd(),
                      (unsigned int)std::chrono::high_resolution_clock::now()
                          .time_since_epoch()
                          .count(),
                      tid, tcount};
    std::mt19937 rng(seq);

#pragma omp for nowait
    for (int i = 0; i < n; ++i) {
      if (!g.has_value[i])
        continue;

      std::vector<int> single = {i};
      double spread = estimate_weighted_spread(g, single, mc_rounds, rng);
      local_pq.push({i, spread, 0});
    }

#pragma omp critical
    {
      while (!local_pq.empty()) {
        pq.push(local_pq.top());
        local_pq.pop();
      }
    }
  }

  double current_val = 0.0;

  for (int iteration = 0; iteration < k; ++iteration) {
    bool found_best = false;

    while (!found_best && !pq.empty()) {
      NodeGain top = pq.top();
      pq.pop();

      if (seeds.find(top.node_id) != seeds.end())
        continue;

      if (top.iteration_computed == (int)seeds.size()) {
        seeds.insert(top.node_id);
        current_val += top.marginal_gain;
        found_best = true;
        std::cout << "Selected Node " << g.reverse_id_map[top.node_id]
                  << " (Val: " << g.node_values[top.node_id] << ")"
                  << " | Marginal Gain: " << top.marginal_gain
                  << " | Total Weighted Reach: " << current_val << std::endl;
      } else {
        std::vector<int> temp_seeds(seeds.begin(), seeds.end());
        temp_seeds.push_back(top.node_id);

        std::random_device rd;
        std::seed_seq seq{
            rd(),
            (unsigned int)std::chrono::high_resolution_clock::now()
                .time_since_epoch()
                .count(),
            (unsigned int)top.node_id};
        std::mt19937 rng(seq);

        double new_val =
            estimate_weighted_spread(g, temp_seeds, mc_rounds, rng);
        double marginal_gain = new_val - current_val;
        pq.push({top.node_id, marginal_gain, (int)seeds.size()});
      }
    }

    if (!found_best) {
      std::cerr << "Warning: priority queue exhausted before selecting k=" << k
                << " seeds. Selected " << seeds.size() << " seeds."
                << std::endl;
      break;
    }
  }

  return seeds;
}

int main(int argc, char *argv[]) {
  if (argc < 4 || argc > 5) {
    std::cerr << "Usage: " << argv[0]
              << " <gexf_file> <k> <attribute_name> [mc_rounds]" << std::endl;
    return 1;
  }

  std::string filename = argv[1];
  int k = std::stoi(argv[2]);
  std::string attr_name = argv[3];
  int mc_rounds = DEFAULT_MC_ROUNDS;
  if (argc == 5)
    mc_rounds = std::stoi(argv[4]);

  try {
    std::cout << "Parsing GEXF..." << std::endl;
    Graph g = GEXFParser::parse(filename, attr_name);

    std::cout << "Nodes: " << g.num_nodes() << std::endl;
    std::cout << "Eligible seeds (has attribute): ";
    int eligible = 0;
    for (int i = 0; i < g.num_nodes(); ++i)
      if (g.has_value[i])
        eligible++;
    std::cout << eligible << std::endl;

    std::cout << "Running Weighted CELF with mc_rounds=" << mc_rounds << "..."
              << std::endl;

    auto start = std::chrono::high_resolution_clock::now();
    std::set<int> seeds = celf_weighted_influence(g, k, mc_rounds);
    auto end = std::chrono::high_resolution_clock::now();

    std::cout << "---------------------------------" << std::endl;
    std::cout << "Selected Seeds: ";
    for (int s : seeds)
      std::cout << g.reverse_id_map[s] << " ";
    std::cout << std::endl;

    std::chrono::duration<double> elapsed = end - start;
    std::cout << "Time: " << elapsed.count() << "s" << std::endl;

  } catch (const std::exception &e) {
    std::cerr << "Error: " << e.what() << std::endl;
    return 1;
  }

  return 0;
}
