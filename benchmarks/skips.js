var runner = require('./runner');

var benchmark = process.argv[2],
    N = process.argv[3] || 1000,
    C = process.argv[4] || 50,
    spec = 'skips',
    results = [spec, N, C].join('.');

function noSkips() {
  var runner = this;
  this.viewFactory = function noSkips(model) {
    runner.noHardSkips(model);
    runner.noSoftSkips(model);
    return this.noRenderer(model);
  };
}

function onlyHardSkips() {
  var runner = this;
  this.viewFactory = function onlyHardSkips(model) {
    runner.noSoftSkips(model);
    return this.noRenderer(model);
  };
}

function onlySoftSkips() {
  var runner = this;
  this.viewFactory = function onlySoftSkips(model) {
    runner.noHardSkips(model);
    return this.noRenderer(model);
  };
}

function hardSoftSkips() {
  var runner = this;
  this.viewFactory = function hardSoftSkips(model) {
    return this.noRenderer(model);
  };  
}

function setup() {
  var runner = this,
      Graph = vg.dataflow.Graph.prototype,
      propagate = Graph.propagate,
      reevaluate = Graph.reevaluate;

  this.noHardSkips = function(model) {
    var schedule = function(a, b) {
      // If the nodes are equal, propagate the non-reflow pulse first,
      // so that we can ignore subsequent reflow pulses. 
      if(a.rank == b.rank) return a.pulse.reflow ? 1 : -1;
      else return a.rank - b.rank; 
    };

    Graph.propagate = function(pulse, node) {
      var v, l, n, p, r, i, len, reflowed;

      // new PQ with each propagation cycle so that we can pulse branches
      // of the dataflow graph during a propagation (e.g., when creating
      // a new inline datasource).
      var pq = new vg.util.Heap(schedule); 

      if(pulse.stamp) throw "Pulse already has a non-zero stamp"

      pulse.stamp = ++this._stamp;
      pq.push({ node: node, pulse: pulse, rank: node.rank() });

      while (pq.size() > 0) {
        v = pq.pop(), n = v.node, p = v.pulse, r = v.rank, l = n._listeners;
        reflowed = p.reflow && n.last() >= p.stamp;

        // !! NO HARD SKIPS !!
        // if(reflowed) continue; // Don't needlessly reflow ops.

        // A node's rank might change during a propagation (e.g. instantiating
        // a group's dataflow branch). Re-queue if it has. T
        // TODO: use pq.replace or pq.poppush?
        if(r != n.rank()) {
          vg.util.debug(p, ['Rank mismatch', r, n.rank()]);
          pq.push({ node: n, pulse: p, rank: n.rank() });
          continue;
        }

        p = this.evaluate(p, n);

        // Even if we didn't run the node, we still want to propagate 
        // the pulse. 
        if (p !== this.doNotPropagate) {
          for (i = 0, len = l.length; i < len; i++) {
            pq.push({ node: l[i], pulse: p, rank: l[i]._rank });
          }
        }
      }
    };

    return model;
  };

  this.noSoftSkips = function(model) {
    Graph.reevaluate = function() { return true; };
    return model;
  };

  this.noRenderer = function(model) {
    var ctr = vg.core.View.factory(model);
    return function(opt) {
      var view = ctr(opt);
      view._renderer.render = function() {}
      return view;
    };
  };

  this.benchmark = function(view, results) {
    var name  = (this.viewFactory||{}).name || 'hardSoftSkips',
        model = view.model(),
        cs = vg.dataflow.changeset.create(null, true),
        next;

    results[results.length-1].type = name+' '+results[results.length-1].type;
    results[results.length-2].type = name+' '+results[results.length-2].type;

    next = Date.now();
    model.graph.signal('norm1').value('athletes').fire();
    results.push({type: name + ' norm', time: Date.now() - next});

    next = Date.now();
    model.graph.signal('norm2').value('gdp').fire();
    results.push({type: name + ' norm', time: Date.now() - next});

    // Only update the other signal
    next = Date.now();
    model.graph.signal('foldField').value('bronze').fire();
    results.push({type: name + ' foldField', time: Date.now() - next});

    // Update both
    var node = new vg.dataflow.Node(model.graph)
      .addListener(model.graph.signal('norm1'))
      .addListener(model.graph.signal('norm2'))
      .addListener(model.graph.signal('foldField'));

    next = Date.now();
    cs.signals = {norm1: 1, norm: 1, foldField: 1};
    model.graph.signal('norm1').value('pop');
    model.graph.signal('norm2').value('athletes');
    model.graph.signal('foldField').value('silver');
    model.graph.propagate(cs, node);
    results.push({type: name + ' both signals', time: Date.now() - next});
  };
};

switch(benchmark) {
  case 'noSkips':       runner('vg2', spec, N, C, results, setup, noSkips);       break;
  case 'onlyHardSkips': runner('vg2', spec, N, C, results, setup, onlyHardSkips); break;
  case 'onlySoftSkips': runner('vg2', spec, N, C, results, setup, onlySoftSkips); break;
  case 'hardSoftSkips': runner('vg2', spec, N, C, results, setup, hardSoftSkips); break;
}