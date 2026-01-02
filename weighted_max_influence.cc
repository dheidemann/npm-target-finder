#include <chrono>
#include <fstream>
#include <iostream>
#include <map>
#include <queue>
#include <random>
#include <set>
#include <string>
#include <vector>
#include <omp.h>

const int MC_ROUNDS = 1000;

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

  int get_internal_id(const std::string &gexf_id) {
    if (id_map.find(gexf_id) == id_map.end()) {
      int new_id = reverse_id_map.size();
      id_map[gexf_id] = new_id;
      reverse_id_map.push_back(gexf_id);
      adj.resize(new_id + 1);
      node_values.resize(new_id + 1, 0.0);
      return new_id;
    }
    return id_map[gexf_id];
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
  }

  int num_nodes() const { return reverse_id_map.size(); }
};

class GEXFParser {
public:
  static Graph parse(const std::string &filename,
                     const std::string &target_attr_name) {
    Graph g;
    std::ifstream file(filename);
    if (!file.is_open())
      throw std::runtime_error("Cannot open file");

    std::string line;
    std::string target_attr_id = "";
    bool in_node = false;
    std::string current_node_id = "";

    while (std::getline(file, line)) {
      size_t tag_start = line.find("<");
      if (tag_start == std::string::npos)
        continue;
      if (line.find("<attribute") != std::string::npos) {
        std::string title = get_xml_attr(line, "title");
        if (title == target_attr_name) {
          target_attr_id = get_xml_attr(line, "id");
          std::cout << "Found Attribute ID for '" << title
                    << "': " << target_attr_id << std::endl;
        }
      }

      if (line.find("<node") != std::string::npos) {
        current_node_id = get_xml_attr(line, "id");
        g.get_internal_id(current_node_id);
        in_node = true;

        if (line.find("/>") != std::string::npos)
          in_node = false;
      }

      if (in_node && line.find("<attvalue") != std::string::npos) {
        if (target_attr_id.empty())
          continue;

        std::string for_id = get_xml_attr(line, "for");
        if (for_id == target_attr_id) {
          std::string val_str = get_xml_attr(line, "value");
          try {
            double val = std::stod(val_str);
            g.set_node_value(current_node_id, val);
          } catch (...) {
          }
        }
      }

      if (line.find("</node>") != std::string::npos) {
        in_node = false;
      }

      if (line.find("<edge") != std::string::npos) {
        std::string s = get_xml_attr(line, "source");
        std::string t = get_xml_attr(line, "target");
        std::string w_str = get_xml_attr(line, "weight");

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
      }
    }

    if (target_attr_id.empty()) {
      std::cerr << "Warning: Attribute '" << target_attr_name
                << "' not found in GEXF definitions." << std::endl;
    }

    return g;
  }

private:
  static std::string get_xml_attr(const std::string &line,
                                  const std::string &attr) {
    std::string needle = attr + "=\"";
    size_t start = line.find(needle);
    if (start == std::string::npos)
      return "";

    start += needle.length();
    size_t end = line.find("\"", start);
    if (end == std::string::npos)
      return "";

    return line.substr(start, end - start);
  }
};

double run_weighted_simulation(const Graph &g, const std::set<int> &seeds,
                               std::mt19937 &rng) {
  std::queue<int> q;
  std::set<int> active_set = seeds;
  double total_value = 0.0;

  for (int seed : seeds) {
    q.push(seed);
    total_value += g.node_values[seed];
  }

  while (!q.empty()) {
    int u = q.front();
    q.pop();

    for (const auto &edge : g.adj[u]) {
      int v = edge.to;
      if (active_set.find(v) == active_set.end()) {
        std::uniform_real_distribution<double> dist(0.0, 1.0);
        if (dist(rng) <= edge.probability) {
          active_set.insert(v);
          total_value += g.node_values[v];
          q.push(v);
        }
      }
    }
  }
  return total_value;
}

double estimate_weighted_spread(const Graph &g, const std::set<int> &seeds) {
  double total_spread = 0.0;

#pragma omp parallel
  {
    std::mt19937 rng(std::random_device{}());
    double local_sum = 0.0;

#pragma omp for nowait
    for (int i = 0; i < MC_ROUNDS; ++i) {
      local_sum += run_weighted_simulation(g, seeds, rng);
    }

#pragma omp atomic
    total_spread += local_sum;
  }

  return total_spread / MC_ROUNDS;
}

struct NodeGain {
  int node_id;
  double marginal_gain;
  int iteration_computed;

  bool operator<(const NodeGain &other) const {
    return marginal_gain < other.marginal_gain;
  }
};

std::set<int> celf_weighted_influence(const Graph &g, int k) {
  std::set<int> seeds;
  std::priority_queue<NodeGain> pq;

  int n = g.num_nodes();
  std::cout << "Initializing CELF (calculating base weighted influence for "
            << n << " nodes)..." << std::endl;

#pragma omp parallel
  {
    std::priority_queue<NodeGain> local_pq;

#pragma omp for nowait
    for (int i = 0; i < n; ++i) {
      if (g.node_values[i] == 0 && g.adj[i].empty())
        continue;

      double spread = estimate_weighted_spread(g, {i});
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

      if (top.iteration_computed == seeds.size()) {
        seeds.insert(top.node_id);
        current_val += top.marginal_gain;
        found_best = true;
        std::cout << "Selected Node " << g.reverse_id_map[top.node_id]
                  << " (Val: " << g.node_values[top.node_id] << ")"
                  << " | Marginal Gain: " << top.marginal_gain
                  << " | Total Weighted Reach: " << current_val << std::endl;
      } else {
        std::set<int> temp_seeds = seeds;
        temp_seeds.insert(top.node_id);
        double new_val = estimate_weighted_spread(g, temp_seeds);
        double marginal_gain = new_val - current_val;
        pq.push({top.node_id, marginal_gain, (int)seeds.size()});
      }
    }
  }
  return seeds;
}

int main(int argc, char *argv[]) {
  if (argc != 4) {
    std::cerr << "Usage: " << argv[0] << " <gexf_file> <k> <attribute_name>"
              << std::endl;
    return 1;
  }

  std::string filename = argv[1];
  int k = std::stoi(argv[2]);
  std::string attr_name = argv[3];

  try {
    std::cout << "Parsing GEXF..." << std::endl;
    Graph g = GEXFParser::parse(filename, attr_name);

    std::cout << "Nodes: " << g.num_nodes() << std::endl;
    std::cout << "Running Weighted CELF..." << std::endl;

    auto start = std::chrono::high_resolution_clock::now();
    std::set<int> seeds = celf_weighted_influence(g, k);
    auto end = std::chrono::high_resolution_clock::now();

    std::cout << "---------------------------------" << std::endl;
    std::cout << "Optimal Seeds: ";
    for (int s : seeds)
      std::cout << g.reverse_id_map[s] << " ";
    std::cout << std::endl;

    std::chrono::duration<double> elapsed = end - start;
    std::cout << "Time: " << elapsed.count() << "s" << std::endl;

  } catch (const std::exception &e) {
    std::cerr << "Error: " << e.what() << std::endl;
  }

  return 0;
}
