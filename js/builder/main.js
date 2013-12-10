define(["vis/scaffold", "metabolic-map/utils", "lib/d3", "lib/complete.ly"], function(scaffold, utils, d3, completely) {
    // TODO
    // - connected node object
    // - only display each node once
    // - Make metabolites and reaction locations (center, main_axis, etc.) actual
    //   coordinates rather than unrotated coords.
    //   
    // see this thread: https://groups.google.com/forum/#!topic/d3-js/Not1zyWJUlg
    // only necessary for selectAll()
    // .datum(function() {
    //     return this.parentNode.__data__;
    // })
    return function(options) {
        // set defaults
        var o = scaffold.set_options(options, {
            margins: {top: 10, right: 10, bottom: 10, left: 20},
            selection: d3.select("body").append("div"),
            selection_is_svg: false,
            fillScreen: false,
            update_hook: false,
            map_path: null,
            map: null,
            cobra_model_path: null,
            cobra_model: null,
            css_path: null,
            css: null,
            flux_path: null,
            flux: null,
            flux2_path: null,
            flux2: null,
	    show_beziers: false,
	    debug: false,
	    starting_reaction: 'ACALDtex',
	    reaction_arrow_displacement: 35 });

        if (o.selection_is_svg) {
            console.error("Builder does not support placement within svg elements");
            return null;
        }

        var files_to_load = [{ file: o.map_path, value: o.map, callback: set_map },
                             { file: o.cobra_model_path, value: o.cobra_model, callback: set_cobra_model },
                             { file: o.css_path, value: o.css, callback: set_css },
                             { file: o.flux_path, value: o.flux,
                               callback: function(e, f) { set_flux(e, f, 0); } },
                             { file: o.flux2_path, value: o.flux2,
                               callback: function(e, f) { set_flux(e, f, 1); } } ];
        scaffold.load_files(files_to_load, setup);
        return {};

        // Definitions
        function set_map(error, map) {
            if (error) console.warn(error);
            o.map = map;
        };
        function set_cobra_model(error, cobra_model) {
            if (error) console.warn(error);
            o.cobra_model = cobra_model;
        }
        function set_css(error, css) {
            if (error) console.warn(error);
            o.css = css;
        };
        function set_flux(error, flux, index) {
            if (error) console.warn(error);
            if (index==0) o.flux = flux;
            else if (index==1) o.flux2 = flux;
        };
        function setup() {
            /* Load the svg container and draw a loaded map if provided.
             */

            // Begin with some definitions
            o.selected_node = {'node_id': '',
                               'is_selected': false};
            o.drawn_reactions = {};
            o.arrowheads_generated = [];
            o.default_reaction_color = '#505050';
            o.decimal_format = d3.format('.3g');
            o.window_translate = {'x': 0, 'y': 0};
            o.window_scale = 1;
	    o.zoom_enabled = true;
	    o.shift_key_on = false;

	    // Check the cobra model
	    if (o.cobra_model) {
		// TODO better checks
		o.cobra_reactions = o.cobra_model.reactions;
	    }

	    // set up the svg
            var out = scaffold.setup_svg(o.selection, o.selection_is_svg,
                                         o.margins, o.fill_screen);
            o.svg = out.svg;
            o.height = out.height;
            o.width = out.width;

            // setup menu and status bars
            o.menu = setup_menu(o.selection);
            o.status = setup_status(o.selection);

            // setup the reaction input with complete.ly
            o.reaction_input = setup_reaction_input(o.selection);


            // set up keyboard listeners
            setup_key_listeners();

	    // import map
	    var max_w = o.width, max_h = o.height;
	    if (o.map) {
		out = import_map(o.map, o.height, o.width);
		o.drawn_reactions = out.map.reactions;
		o.drawn_nodes = out.map.nodes;
		o.membranes = out.map.membranes;
		o.drawn_text_labels = out.map.text_labels;
		max_w = out.max_map_w;
		max_h = out.max_map_h;
	    } else {
		o.membranes = [];
		max_w = o.width;
		max_h = o.height;
	    }

	    // set up svg and svg definitions
	    o.scale = utils.define_scales(max_w, max_h,
					  o.width, o.height);

            var defs = utils.setup_defs(o.svg, o.css),
                out = utils.setup_zoom_container(o.svg, o.width, o.height, [0.05, 15], 
						 function(ev) {
						     o.window_translate = {'x': ev.translate[0], 'y': ev.translate[1]};
						     o.window_scale = ev.scale;
						 }, 
						 function() { return o.zoom_enabled; });
	    // TODO fix like this http://jsfiddle.net/La8PR/5/
            o.sel = out.sel,
            o.zoom = out.zoom;

            var extent = {"x": o.width*3, "y": o.height*3},
		mouse_node = o.sel.append('rect')
                    .attr("width", extent.x)
                    .attr("height", extent.y)
		    .attr("transform",
			  "translate("+(-extent.x/3)+","+(-extent.y/3)+")")
                    .attr("style", "stroke:black;fill:none;")
                    .attr('pointer-events', 'all');

            o.sel.append('g')
                .attr('id', 'brush-container');
            o.sel.append('g')
                .attr('id', 'membranes');
            o.sel.append('g')
                .attr('id', 'reactions');
            o.sel.append('g')
                .attr('id', 'nodes');
            o.sel.append('g')
                .attr('id', 'text-labels');

	    // make a list of reactions
	    o.sorted_reaction_suggestions = [];
	    for (var reaction_id in o.cobra_reactions) {
		o.sorted_reaction_suggestions.push({
		    label: reaction_id,
		    cobra_id: reaction_id,
		    flux: 0
                });
	    }
	    if (o.flux) { 
		// flux onto existing map reactions
		if (o.map) {
		    for (var reaction_id in o.map.reactions) {
			var reaction = o.map.reactions[reaction_id];
			if (reaction_id in o.flux) {
			    var flux = parseFloat(o.flux[reaction_id]);
			    reaction.flux = flux;
			    for (var met_id in reaction.segments) {
				var metabolite = reaction.segments[met_id];
				metabolite.flux = flux;
			    }
			}
		    }
		}

		// reactions with flux
		for (var flux_reaction_id in o.flux) {
                    // fix reaction ids
                    var fixed_id = flux_reaction_id.replace('(', '_').replace(')', ''),
			flux = parseFloat(o.flux[flux_reaction_id]);
                    // update model with fluxes. if not found, add the empty reaction to the list
		    var found = false;
		    o.sorted_reaction_suggestions.map(function(x) {
			if (fixed_id == x.cobra_id) {
			    // update label
			    x.label = x.label+": "+o.decimal_format(flux);
			    x.flux = flux;
			    // set flux for reaction
                            o.cobra_reactions[fixed_id].flux = flux;
                            // also set flux for segments (for simpler drawing)
                            for (var metabolite_id in o.cobra_reactions[fixed_id].segments)
				o.cobra_reactions[fixed_id].segments[metabolite_id].flux = flux;
			    // this reaction has been found
			}
                    });
		}
		// sort the reactions by flux
		o.sorted_reaction_suggestions.sort(function(a, b) { 
		    return Math.abs(b.flux) - Math.abs(a.flux); 
		});
	    }

            // setup selection box
            if (!o.map) {
		// TEST case
		var start_coords = {'x': o.width/2, 'y': 40};
                new_reaction(o.starting_reaction, start_coords);
            } else {
		draw();
	    }

            d3.select('#loading').style("display", "none");
	    return;

            // definitions
            function setup_menu(selection) {
                var sel = selection.append("div").attr("id", "menu");
                new_button(sel, cmd_hide_show_input, "New reaction (/)");
                new_button(sel, cmd_cycle_primary_metabolite, "Cycle primary metabolite (p)");
                new_button(sel, cmd_left, "Left (←)");
                new_button(sel, cmd_right, "Right (→)");
                new_button(sel, cmd_up, "Up (↑)");
                new_button(sel, cmd_down, "Down (↓)");
                new_button(sel, cmd_save, "Save (^s)");
                o.load_input_click_fn = new_input(sel, cmd_load, "Load (^o)");
		if (o.show_beziers) new_button(sel, cmd_hide_beziers, "Hide control points");
		else new_button(sel, cmd_show_beziers, "Show control points");

		var z;
		if (o.zoom_enabled) z = new_button(sel, cmd_zoom_off, "Enable select (v)");
		else z = new_button(sel, cmd_zoom_on, "Enable pan+zoom (z)");
		z.attr('id', 'zoom-button');

                return sel;

                function new_button(s, fn, name) {
                    return s.append("button").attr("class", "command-button")
                        .text(name).on("click", fn);
                }
                function new_input(s, fn, name) {
                    /* 
		     * Returns a function that can be called to programmatically
                     * load files.
                     */
                    var input = s.append("input").attr("class", "command-button")
                            .attr("type", "file")
                            .style("display", "none")
                            .on("change", function() {
                                utils.load_json(this.files[0], function(error, data) {
                                    if (error) return console.warn(error);
                                    o.drawn_reactions = data;
                                    reset();
                                    draw();
                                    return null;
                                });
                            });
                    new_button(sel, function(e) {
                        input.node().click();
                    }, name);
                    return function() { input.node().click(); };
                }
            }
            function setup_reaction_input(selection) {
                // set up container
                var sel = selection.append("div").attr("id", "rxn-input");
                sel.style("display", "none");
                // set up complete.ly
                var complete = completely(sel.node(), { backgroundColor: "#eee" });
                d3.select(complete.input)
                // .attr('placeholder', 'Reaction ID -- Flux')
                    .on('input', function() {
                        this.value = this.value.replace("/","")
                            .replace(" ","")
                            .replace("\\","")
                            .replace("<","");
                    });
                return { selection: sel,
                         completely: complete };
            }
            function setup_status(selection) {
                return selection.append("div").attr("id", "status");
            }
        }
	function enable_brush(on) {
	    var brush_sel = o.sel.select('#brush-container');
	    if (on) {
		o.selection_brush = setup_selection_brush(brush_sel, 
							  d3.select('#nodes').selectAll('.node'),
							  o.width, o.height);
	    } else {
		brush_sel.selectAll('.brush').remove();
	    }

	    // definitions
	    function setup_selection_brush(selection, node_selection, width, height) {
		var node_ids = [];
		node_selection.each(function(d) { node_ids.push(d.node_id); });
		var brush_fn = d3.svg.brush()
			.x(d3.scale.identity().domain([0, width]))
			.y(d3.scale.identity().domain([0, height]))
			.on("brush", function() {
			    var extent = d3.event.target.extent();
			    node_selection
				.classed("selected", function(d) { 
				    var sx = o.scale.x(d.x), sy = o.scale.y(d.y);
				    return extent[0][0] <= sx && sx < extent[1][0]
					    && extent[0][1] <= sy && sy < extent[1][1];
				});
			})        
			.on("brushend", function() {
			    d3.event.target.clear();
			    d3.select(this).call(d3.event.target);
			}),
		    brush = selection.append("g")
			.attr("class", "brush")
			.call(brush_fn);
		return brush;
	    }
	}

	function import_map(map) {
	    /* 
	     * Load a json map and add necessary fields for rendering.
	     *
	     * The returned value will be o.drawn_reactions.
	     */
	    if (o.debug) {
		var required_node_props = ['node_type', 'x', 'y',
					   'connected_segments'],
		    required_reaction_props = ["segments", 'name', 'direction', 'abbreviation'],
		    required_segment_props = ['from_node_id', 'to_node_id'],
		    required_text_label_props = ['text', 'x', 'y'];
		for (var node_id in map.nodes) {
		    var node = map.nodes[node_id];
		    node.selected = false; node.previously_selected = false;
		    required_node_props.map(function(req) {
			if (!node.hasOwnProperty(req)) console.error("Missing property " + req);
		    });
		}
		for (var reaction_id in map.reactions) {
		    var reaction = map.reactions[reaction_id];
		    required_reaction_props.map(function(req) {
			if (!reaction.hasOwnProperty(req)) console.error("Missing property " + req);
		    });
		    for (var segment_id in reaction.segments) {
			var metabolite = reaction.segments[segment_id];
			required_segment_props.map(function(req) {
			    if (!metabolite.hasOwnProperty(req)) console.error("Missing property " + req);
			});
		    }
		}
		for (var text_label_id in map.text_labels) {
		    var text_label = map.text_labels[text_label_id];
		    required_text_label_props.map(function(req) {
			if (!text_label.hasOwnProperty(req)) console.error("Missing property " + req);
		    });
		}
	    }
	    return { map: map,
		     max_map_w: map.info.max_map_w,
		     max_map_h: map.info.max_map_h };
	}

        function set_status(status) {
            // TODO put this in js/metabolic-map/utils.js
            var t = d3.select('body').select('#status');
            if (t.empty()) t = d3.select('body')
                .append('text')
                .attr('id', 'status');
            t.text(status);
            return this;
        }

        function place_reaction_input(coords) {
            var d = {'x': 280, 'y': 0},
                input = o.reaction_input;
            var left = Math.max(20, Math.min(o.width-270, (o.window_scale * coords.x + o.window_translate.x - d.x)));
            var top = Math.max(20, Math.min(o.height-40, (o.window_scale * coords.y + o.window_translate.y - d.y)));
            // blur
            input.completely.input.blur();
            input.selection.style('position', 'absolute')
                .style('display', 'block')
                .style('left',left+'px')
                .style('top',top+'px');
            input.completely.repaint();
        }

        function reload_reaction_input(coords) {
            /* Reload data for autocomplete box and redraw box at the new
             * coordinates.
             */
            place_reaction_input(coords);

            // Find selected reaction
            var reaction_ids_to_display = [],
                already_drawn = function(reaction_id) {
                    for (var drawn_id in o.drawn_reactions)
                        if (reaction_id==drawn_id) return true;
                    return false;
                };
            for (var reaction_id in o.cobra_reactions) {
                var reaction = o.cobra_reactions[reaction_id];
                // ignore drawn reactions
                if (already_drawn(reaction_id)) continue;
                if (o.selected_node.is_selected) {
                    // check segments for match to selected metabolite
                    // for (var metabolite_id in reaction.segments) {
                    //     if (metabolite_id==o.selected_node.metabolite_id &&
                    //         reaction.segments[metabolite_id].coefficient < 0) {
                    //         reaction_ids_to_display.push(reaction_id);
                    //     }
                    // }
                } else {
                    // reaction_ids_to_display.push(reaction_id);
                }
            }

            // Generate the list of reactions to suggest
            var filtered_suggestions = o.sorted_reaction_suggestions.filter(function(x) {
                return reaction_ids_to_display.indexOf(x.cobra_id) > -1;
            });
            // Make an array of strings to suggest, and an object to retrieve
            // the reaction ids
            var i = -1, reaction_obj = {}, strings_to_display = [];
            while (++i < filtered_suggestions.length) {
                reaction_obj[filtered_suggestions[i].label] = filtered_suggestions[i].cobra_id;
                strings_to_display.push(filtered_suggestions[i].label);
            };

            // set up the box with data, searching for first num results
            var num = 20;
            var complete = o.reaction_input.completely;
            complete.options = strings_to_display;
            if (reaction_ids_to_display.length==1) complete.setText(reaction_ids_to_display[0]);
            else complete.setText("");
            complete.onEnter = function() {
                if (reaction_obj.hasOwnProperty(this.getText()))
                    new_reaction(reaction_obj[this.getText()], coords);
                this.setText("");
            };
            complete.repaint();
            o.reaction_input.completely.input.focus();
        }



        function new_reaction(reaction_id, coords) {
            /* New reaction at x, y coordinates.
	     */

            // If reaction id is not new, then return:
            if (o.drawn_reactions.hasOwnProperty(reaction_id)) {
                console.warn('reaction is already drawn');
                return;
            }

            // set reaction coordinates and angle
            // be sure to copy the reaction recursively
            var reaction = utils.clone(o.cobra_reactions[reaction_id]);
            // calculate coordinates of reaction
            reaction = utils.calculate_new_reaction_coordinates(reaction, coords);

            // set primary metabolites and count reactants/products
            var primary_reactant_index = 0,
                primary_product_index = 0,
                reactant_count = 0, product_count = 0,
                newest_primary_product_id = "";

            for (var metabolite_id in reaction.segments) {
                var metabolite = reaction.segments[metabolite_id];
                if (metabolite.coefficient < 0) {
                    metabolite.index = reactant_count;
                    if (reactant_count==primary_reactant_index) metabolite.is_primary = true;
                    reactant_count++;
                } else {
                    metabolite.index = product_count;
                    if (product_count==primary_product_index) {
                        metabolite.is_primary = true;
                        newest_primary_product_id = metabolite_id;
                    };
                    product_count++;
                }
            }

            // keep track of total reactants and products
            for (metabolite_id in reaction.metabolites) {
                metabolite = reaction.metabolites[metabolite_id];
                var primary_index;
                if (metabolite.coefficient < 0) {
                    metabolite.count = reactant_count + 1;
                    primary_index = primary_reactant_index;
                } else {
                    metabolite.count = product_count + 1;
                    primary_index = primary_product_index;
                }

                // record reaction_id with each metabolite
                metabolite.reaction_id = reaction_id;

                // calculate coordinates of metabolite components
                metabolite = utils.calculate_new_metabolite_coordinates(metabolite,
									primary_index,
									reaction.main_axis,
									reaction.center,
									reaction.dis);
	    }

	    // rotate the new reaction
	    var angle = Math.PI / 2; // default angle
	    reaction = rotate_reaction(reaction, angle, coords);

            // append the new reaction
            o.drawn_reactions[reaction_id] = reaction;

            // draw, and set the new coords
            o.selected_node = {'reaction_id': reaction_id,
                               'direction': "product",
                               'metabolite_id': newest_primary_product_id,
                               'is_selected': true};
            draw();
            var new_coords = coords_for_selected_node();
            translate_off_screen(new_coords);
            if (reaction_input_is_visible())
                reload_reaction_input(new_coords);
        }

        // -----------------------------------------------------------------------------------
        // DRAW

        function draw() {
            /* Draw the reactions and membranes
             */

	    // draw the membranes
	    var sel = d3.select('#membranes')
		.selectAll('.membrane')
		.data(o.membranes);
            // enter: generate and place reaction
            sel.enter().call(create_membrane);
            // update: update when necessary
            sel.call(update_membrane);
            // exit
            sel.exit().remove();

            // reactions
            sel = d3.select('#reactions')
                .selectAll('.reaction')
                .data(make_array(o.drawn_reactions, 'reaction_id'),
                      function(d) { return d.reaction_id; });
            // enter: generate and place reaction
            sel.enter().call(create_reaction);
            // update: update when necessary
            sel.call(update_reaction);
            // exit
            sel.exit().remove();

            // nodes
            sel = d3.select('#nodes')
                .selectAll('.node')
                .data(make_array(o.drawn_nodes, 'node_id'),
                      function(d) { return d.node_id; });
            // enter: generate and place reaction
            sel.enter().call(create_node);
            // update: update when necessary
            sel.call(update_node);
            // exit
            sel.exit().remove();

	    // Draw the labels
            sel = d3.select('#text-labels')
                .selectAll('.text-label')
                .data(make_array(o.drawn_text_labels, 'text_label_id'),
                      function(d) { return d.text_label_id; });
            // enter: generate and place reaction
            sel.enter().call(create_text_label);
            // update: update when necessary
            sel.call(update_text_label);
            // exit
            sel.exit().remove();
        }

        function create_membrane(enter_selection) {
	    enter_selection.append('rect')
		.attr('class', 'membrane');
	}

        function update_membrane(update_selection) {
            update_selection
                .attr("width", function(d){ return o.scale.x_size(d.width); })
                .attr("height", function(d){ return o.scale.y_size(d.height); })
                .attr("transform", function(d){return "translate("+o.scale.x(d.x)+","+o.scale.y(d.y)+")";})
                .style("stroke-width", function(d) { return o.scale.size(10); })
                .attr('rx', function(d){ return o.scale.x_size(20); })
                .attr('ry', function(d){ return o.scale.x_size(20); });
        }

        function create_reaction(enter_selection) {
            // attributes for new reaction group

            var t = enter_selection.append('g')
                    .attr('id', function(d) { return d.reaction_id; })
                    .attr('class', 'reaction')
                    .call(create_reaction_label);
            return;
        }

        function update_reaction(update_selection) {
            // update reaction label
            update_selection.select('.reaction-label')
                .call(update_reaction_label);

            // select segments
            var sel = update_selection
                    .selectAll('.segment-group')
                    .data(function(d) {
                        return make_array(d.segments, 'segment_id');
                    }, function(d) { return d.segment_id; });

            // new segments
            sel.enter().call(create_segment);

            // update segments
            sel.call(update_segment);

            // old segments
            sel.exit().remove();

            return;
        }

        function create_reaction_label(sel) {
            /* Draw reaction label for selection.
	     */
            sel.append('text')
		.text(function(d) { return d.abbreviation; })
                .attr('class', 'reaction-label label')
                .attr('pointer-events', 'none');
        }

        function update_reaction_label(sel) {
	    sel
		.attr('transform', function(d) {
                    return 'translate('+o.scale.x(d.label_x)+','+o.scale.y(d.label_y)+')';
		})
                .style("font-size", function(d) {
		    return String(o.scale.size(30))+"px";
                });
        }

        function create_segment(enter_selection) {
            // create segments
            var g = enter_selection
                    .append('g')
                    .attr('class', 'segment-group')
                    .attr('id', function(d) { return d.segment_id; });

            // create reaction arrow
            g.append('path')
                .attr('class', 'segment');

	    // THE FOLLOWING IS ALL TERRIBLE

	    // new bezier points
	    var g = g.append('g')
		    .attr('class', 'beziers');

	    g.append('circle')
		.attr('class', 'bezier bezier1')
		.style('stroke-width', String(o.scale.size(1))+'px') 
		.call(d3.behavior.drag()
		      .on("dragstart", drag_silence)
		      .on("drag", drag_move_1))		
		.on("mouseover", function(d) {
		    d3.select(this).style('stroke-width', String(o.scale.size(2))+'px');
		})
		.on("mouseout", function(d) {
		    d3.select(this).style('stroke-width', String(o.scale.size(1))+'px');
		});

	    // TODO fix this hack
	    g.append('circle')
		.attr('class', 'bezier bezier2')
		.style('stroke-width', String(o.scale.size(1))+'px') 
		.call(d3.behavior.drag()
		      .on("dragstart", drag_silence)
		      .on("drag", drag_move_2))
		.on("mouseover", function(d) {
		    d3.select(this).style('stroke-width', String(o.scale.size(2))+'px');
		})
		.on("mouseout", function(d) {
		    d3.select(this).style('stroke-width', String(o.scale.size(1))+'px');
		});

	    // definitions
	    function drag_silence() {
		// silence other listeners
                d3.event.sourceEvent.stopPropagation();
	    }
	    function drag_move_1() { 
		// TODO fix this hack too
		var segment_id = d3.select(this.parentNode.parentNode).datum().segment_id,
		    reaction_id = d3.select(this.parentNode.parentNode.parentNode).datum().reaction_id;
		var seg = o.drawn_reactions[reaction_id].segments[segment_id],
		    dx = o.scale.x_size.invert(d3.event.dx),
		    dy = o.scale.y_size.invert(d3.event.dy);
		seg.b1.x = seg.b1.x + dx;
		seg.b1.y = seg.b1.y + dy;
		draw_specific_reactions([reaction_id]);
	    }
	    function drag_move_2() { 
		// TODO fix this hack too
		var segment_id = d3.select(this.parentNode.parentNode).datum().segment_id,
		    reaction_id = d3.select(this.parentNode.parentNode.parentNode).datum().reaction_id;
		var seg = o.drawn_reactions[reaction_id].segments[segment_id],
		    dx = o.scale.x_size.invert(d3.event.dx),
		    dy = o.scale.y_size.invert(d3.event.dy);
		seg.b2.x = seg.b2.x + dx;
		seg.b2.y = seg.b2.y + dy;
		draw_specific_reactions([reaction_id]);
	    }
	}
        
        function update_segment(update_selection) {
            // update segment attributes
            // update arrows
            update_selection
                .selectAll('.segment')
                .datum(function() {
                    return this.parentNode.__data__;
                })
                .attr('d', function(d) {
		    if (d.from_node_id==null || d.to_node_id==null)
			return null;
		    var start = o.drawn_nodes[d.from_node_id],
			end = o.drawn_nodes[d.to_node_id],
			b1 = d.b1,
			b2 = d.b2;
		    // if metabolite, then displace the arrow
		    if (start['node_type']=='metabolite') {
			start = displaced_coords(start, end, 'start');
			b1 = displaced_coords(b1, end, 'start');
		    }
		    if (end['node_type']=='metabolite') {
			end = displaced_coords(start, end, 'end');
			b2 = displaced_coords(start, b2, 'end');
		    }
		    if (d.b1==null || d.b2==null) {
			return 'M'+o.scale.x(start.x)+','+o.scale.y(start.y)+' '+
			    o.scale.x(end.x)+','+o.scale.y(end.y);
		    } else {
			return 'M'+o.scale.x(start.x)+','+o.scale.y(start.y)+
                            'C'+o.scale.x(b1.x)+','+o.scale.y(b1.y)+' '+
                            o.scale.x(b2.x)+','+o.scale.y(b2.y)+' '+
                            o.scale.x(end.x)+','+o.scale.y(end.y);
		    }
                }) // TODO replace with d3.curve or equivalent
                .attr("marker-start", function (d) {
		    var start = o.drawn_nodes[d.from_node_id];
		    if (start['node_type']=='metabolite') {
			var c = d.flux ? o.scale.flux_color(Math.abs(d.flux)) :
				o.default_reaction_color;
			// generate arrowhead for specific color
			var arrow_id = generate_arrowhead_for_color(c, false);
			return "url(#" + arrow_id + ")";
		    } else { return null; };
                })     
		.attr("marker-end", function (d) {
		    var end = o.drawn_nodes[d.to_node_id];
		    if (end['node_type']=='metabolite') {
			var c = d.flux ? o.scale.flux_color(Math.abs(d.flux)) :
				o.default_reaction_color;
			// generate arrowhead for specific color
			var arrow_id = generate_arrowhead_for_color(c, true);
			return "url(#" + arrow_id + ")";
		    } else { return null; };
                })
                .style('stroke', function(d) {
		    if (o.flux) 
			return d.flux ? o.scale.flux_color(Math.abs(d.flux)) : o.scale.flux_color(0);
		    else
			return o.default_reaction_color;
		})
		.style('stroke-width', function(d) {
		    return d.flux ? o.scale.size(o.scale.flux(Math.abs(d.flux))) :
			o.scale.size(o.scale.flux(1));
                });
	    console.log(o.show_beziers);
	    if (o.show_beziers) {
		// draw bezier points
		update_selection
		    .selectAll('.bezier1')
                    .attr('transform', function(d) {
			if (d.b1==null) return ""; 
			return 'translate('+o.scale.x(d.b1.x)+','+o.scale.y(d.b1.y)+')';
                    })
		    .attr('r', String(o.scale.size(5))+'px')
		    .style('stroke-width', String(o.scale.size(1))+'px')
                    .style('fill', 'none')
		    .style('stroke', 'blue')
		    .attr('visibility', 'visible');
		update_selection
		    .selectAll('.bezier2')
                    .attr('transform', function(d) {
			if (d.b2==null) return "";
			return 'translate('+o.scale.x(d.b2.x)+','+o.scale.y(d.b2.y)+')';
                    })
		    .attr('r', String(o.scale.size(5))+'px')
		    .style('stroke-width', String(o.scale.size(1))+'px')
                    .style('fill', 'none')
		    .style('stroke', 'red')
		    .attr('visibility', 'visible');
	    } else {
		update_selection
		    .selectAll('.bezier1')
		    .attr('visibility', 'hidden');
		update_selection
		    .selectAll('.bezier2')
		    .attr('visibility', 'hidden');
	    }

        }

	function create_node(enter_selection) {
            // create nodes
            var g = enter_selection
                    .append('g')
                    .attr('class', 'node')
                    .attr('id', function(d) { return d.node_id; });

            // create metabolite circle and label
            g.append('circle')
		.attr('class', function(d) {
		    if (d.node_type=='metabolite') return 'node-circle metabolite-circle';
		    else return 'node-circle';
		})		
                .style('stroke-width', String(o.scale.size(2))+'px')
		.on("mouseover", function(d) {
		    d3.select(this).style('stroke-width', String(o.scale.size(3))+'px');
		})
		.on("mouseout", function(d) {
		    d3.select(this).style('stroke-width', String(o.scale.size(2))+'px');
		})
                .call(d3.behavior.drag()
                      .on("dragstart", drag_silence)
                      .on("drag", drag_move))
                .on("click", function(d) { 
		    select_metabolite(this, d, o.sel.select('#nodes').selectAll('.node'), o.shift_key_on);
		});

            g.append('text')
                .attr('class', 'node-label label')
                .text(function(d) { return d.metabolite_simpheny_id; })
                .attr('pointer-events', 'none');

            function drag_silence() {
		// silence other listeners
                d3.event.sourceEvent.stopPropagation();
            }
            function drag_move() {
		var grabbed_id = this.parentNode.__data__.node_id,		    
                    selected_ids = [];
		d3.select('#nodes').selectAll('.selected').each(function(d) { selected_ids.push(d.node_id); });
		if (selected_ids.indexOf(grabbed_id)==-1) { 
		    console.log('Dragging unselected node');
		    return;
		}

		var reaction_ids = [];
		// update node positions
		d3.selectAll('.node').each(function(d) {
		    if (selected_ids.indexOf(d.node_id)==-1) return;
		    // update data
                    var node = o.drawn_nodes[d.node_id],
			dx = o.scale.x_size.invert(d3.event.dx),
			dy = o.scale.y_size.invert(d3.event.dy);
                    node.x = node.x + dx; 
		    node.y = node.y + dy;
		    // update node labels
                    node.label_x = node.label_x + dx;
		    node.label_y = node.label_y + dy;

		    // update connected reactions
		    d.connected_segments.map(function(segment_object) {
			shift_beziers_for_segment(segment_object.reaction_id, segment_object.segment_id, 
						  d.node_id, dx, dy);
			reaction_ids.push(segment_object.reaction_id);
		    });
		});

		draw_specific_nodes(selected_ids);
		draw_specific_reactions(reaction_ids);

		// definitions
		function shift_beziers_for_segment(reaction_id, segment_id, node_id, dx, dy) {
		    var seg = o.drawn_reactions[reaction_id].segments[segment_id];
		    if (seg.from_node_id==node_id && seg.b1) {
			seg.b1.x = seg.b1.x + dx;
			seg.b1.y = seg.b1.y + dy;
		    }
		    if (seg.to_node_id==node_id && seg.b2) {
			seg.b2.x = seg.b2.x + dx;
			seg.b2.y = seg.b2.y + dy;
		    }
		}
            }
	}

	function update_node(update_selection) {
            // update circle and label location
            var mg = update_selection
                    .select('.node-circle')
                    .attr('transform', function(d) {
                        return 'translate('+o.scale.x(d.x)+','+o.scale.y(d.y)+')';
                    })
		    .attr('r', function(d) { 
			if (d.node_type!='metabolite') return o.scale.size(5);
			else return o.scale.size(d.node_is_primary ? 15 : 10); 
		    })
                    .classed('selected', function(d) {
			if (is_sel(d)) return true;
			return false;
                    });

            update_selection
                .select('.node-label')
                .attr('transform', function(d) {
                    return 'translate('+o.scale.x(d.label_x)+','+o.scale.y(d.label_y)+')';
                })
                .style("font-size", function(d) {
		    return String(o.scale.size(20))+"px";
                });

	    // definitions
            function is_sel(d) {
                if (d.node_id==o.selected_node.node_id &&
                    o.selected_node.is_selected)
                    return true;
                return false;
            };
	}

        function create_text_label(enter_selection) {
	    enter_selection.append('text')
		.attr('class', 'text-label label')
		.text(function(d) { return d.text; });
	}

        function update_text_label(update_selection) {
            update_selection
                .attr("transform", function(d) { return "translate("+o.scale.x(d.x)+","+o.scale.y(d.y)+")";});
        }

	// Specific drawing methods
        function draw_specific_reactions(reaction_ids) {
            // find reactions for reaction_ids
            var reaction_subset = {},
                i = -1;
            while (++i<reaction_ids.length) {
                reaction_subset[reaction_ids[i]] = utils.clone(o.drawn_reactions[reaction_ids[i]]);
            }
            if (reaction_ids.length != Object.keys(reaction_subset).length) {
                console.warn('did not find correct reaction subset');
            }

            // generate reactions for o.drawn_reactions
            // assure constancy with cobra_id
            var sel = d3.select('#reactions')
                    .selectAll('.reaction')
                    .data(make_array(reaction_subset, 'reaction_id'),
                          function(d) { return d.reaction_id; });

            // enter: generate and place reaction
            sel.enter().call(create_reaction);

            // update: update when necessary
            sel.call(update_reaction);

            // exit
            sel.exit();
        }

	function draw_specific_nodes(node_ids) {
            // find nodes for node_ids
            var node_subset = {},
                i = -1;
            while (++i<node_ids.length) {
                node_subset[node_ids[i]] = utils.clone(o.drawn_nodes[node_ids[i]]);
            }
            if (node_ids.length != Object.keys(node_subset).length) {
                console.warn('did not find correct node subset');
            }

            // generate nodes for o.drawn_nodes
            // assure constancy with cobra_id
            var sel = d3.select('#nodes')
                    .selectAll('.node')
                    .data(make_array(node_subset, 'node_id'),
                          function(d) { return d.node_id; });

            // enter: generate and place node
            sel.enter().call(create_node);

            // update: update when necessary
            sel.call(update_node);

            // exit
            sel.exit();
	}

        function translate_off_screen(coords) {
            // shift window if new reaction will draw off the screen
            // TODO BUG not accounting for scale correctly
            var margin = 200,
                new_pos,
                current = {'x': {'min': -o.window_translate.x,
                                 'max': (o.width-o.window_translate.x)/o.window_scale},
                           'y': {'min': -o.window_translate.y,
                                 'max': (o.height-o.window_translate.y)/o.window_scale} },
                go = function() {
                    o.zoom.translate([o.window_translate.x, o.window_translate.y]);
                    o.zoom.scale(o.window_scale);
                    o.sel.transition()
                        .attr('transform', 'translate('+o.window_translate.x+','+o.window_translate.y+')scale('+o.window_scale+')');
                };
            if (coords.x < current.x.min + margin) {
                new_pos = -(coords.x - current.x.min - margin) * o.window_scale + o.window_translate.x;
                o.window_translate.x = new_pos;
                go();
            } else if (coords.x > current.x.max - margin) {
                new_pos = -(coords.x - current.x.max + margin) * o.window_scale + o.window_translate.x;
                o.window_translate.x = new_pos;
                go();
            }
            if (coords.y < current.y.min + margin) {
                new_pos = -(coords.y - current.y.min - margin) * o.window_scale + o.window_translate.y;
                o.window_translate.y = new_pos;
                go();
            } else if (coords.y > current.y.max - margin) {
                new_pos = -(coords.y - current.y.max + margin) * o.window_scale + o.window_translate.y;
                o.window_translate.y = new_pos;
                go();
            }
        }

        function coords_for_selected_node() {
            if (o.selected_node.is_selected)
                return get_coords_for_node(o.selected_node.node_id);
            else
                console.log('no node selected');
            return {'x':0, 'y':0};
        }

        function get_coords_for_node(node_id) {
            var node = o.drawn_nodes[node_id],
                coords = {'x': node.x, 'y': node.y};
            return coords;
        }

        function cycle_primary_key() {
            /* Cycle the primary metabolite among the products of the selected reaction.
	     *
	     */

            if (!o.selected_node.is_selected) {
                console.log('no selected node');
                return;
            }

            // get last index
            var last_index, count;
            var reaction = o.drawn_reactions[o.selected_node.reaction_id];
            for (var metabolite_id in reaction.segments) {
                var metabolite = reaction.segments[metabolite_id];
                if ((metabolite.coefficient > 0 && o.selected_node.direction=="product") ||
                    (metabolite.coefficient < 0 && o.selected_node.direction=="reactant")) {
                    if (metabolite.is_primary) {
                        last_index = metabolite.index;
                        count = metabolite.count;
                    }
                }
            }
            // rotate to new index
            var index = last_index + 1 < count - 1 ? last_index + 1 : 0;
            rotate_primary_key(index);
        }

        function rotate_primary_key(index) {
            /* Switch the primary metabolite to the index of a particular product.
	     */

            if (!o.selected_node.is_selected) {
                console.warn('no selected node');
                return;
            }

            // update primary in o.drawn_reactions
            var new_primary_metabolite_id;
            var reaction = o.drawn_reactions[o.selected_node.reaction_id];

            // if primary is selected, then maintain that selection
            var sel_is_primary = reaction.segments[o.selected_node.metabolite_id].is_primary,
                should_select_primary = sel_is_primary ? true : false;

            for (var metabolite_id in reaction.segments) {
                var metabolite = reaction.segments[metabolite_id];
                if ((metabolite.coefficient > 0 && o.selected_node.direction=="product") ||
                    (metabolite.coefficient < 0 && o.selected_node.direction=="reactant")) {
                    if (metabolite.index == index) {
                        metabolite.is_primary = true;
                        new_primary_metabolite_id = metabolite_id;
                    } else {
                        metabolite.is_primary = false;
                    }
                    // calculate coordinates of metabolite components
                    metabolite = utils.calculate_new_metabolite_coordinates(metabolite,
									    index,
                                                                            reaction.main_axis,
									    reaction.center,
									    reaction.dis);
                }
            }

            var coords;
            if (should_select_primary) {
                o.selected_node.node_id = new_primary_node_id;
                coords = get_coords_for_node(o.selected_node.node_id);
            } else {
                coords = get_coords_for_node(o.selected_node.node_id);
            }

            draw_specific_reactions([o.selected_node.reaction_id]);
        }

        function select_metabolite(sel, d, node_selection, shift_key_on) {
	    if (shift_key_on) d3.select(sel.parentNode).classed("selected", !d3.select(sel.parentNode).classed("selected")); //d.selected = !d.selected);
            else node_selection.classed("selected", function(p) { return d === p; });
	    var selected_nodes = d3.select('.selected');
	    if (selected_nodes.length==1 && reaction_input_is_visible())
                reload_reaction_input(coords_for_selected_node(selected_nodes[0]));
	}
    
	function displaced_coords(start, end, displace) {
	    var length = o.reaction_arrow_displacement,
		hyp = utils.distance(start, end),
		new_x, new_y;
	    if (displace=='start') {
		new_x = start.x + length * (end.x - start.x) / hyp,
		new_y = start.y + length * (end.y - start.y) / hyp;
	    } else if (displace=='end') {
		new_x = end.x - length * (end.x - start.x) / hyp,
		new_y = end.y - length * (end.y - start.y) / hyp;
	    } else { console.error('bad displace value: ' + displace); }
	    return {x: new_x, y: new_y};
	}

        function make_array(obj, id_key) { // is this super slow?
            var array = [];
            for (var key in obj) {
                // copy object
                var it = utils.clone(obj[key]);
                // add key as 'id'
                it[id_key] = key;
                // add object to array
                array.push(it);
            }
            return array;
        }

        function reset() {
	    d3.select('#membranes')
                .selectAll('.membrane')
                .remove();
	    d3.select('#reactions')
                .selectAll('.reaction')
                .remove();
        }

	function rotate_reaction_id(cobra_id, angle, center) {
	    /* Rotate reaction with cobra_id in o.drawn_reactions around center.
	     */

	    var reaction = o.drawn_reactions[cobra_id];
	    o.drawn_reactions[cobra_id] = rotate_reaction(reaction,
							  angle, center);
	}
	
        function rotate_reaction(reaction, angle, center_absolute) {
	    /* Rotate reaction around center.
	     */

	    // functions
	    var rotate_around = function(coord) {
		return utils.rotate_coords(coord, angle, center_absolute);
	    };
	    var rotate_around_recursive = function(coords) {
		return utils.rotate_coords_recursive(coords, angle, center_absolute);
	    };
	    var rotate_around_rel = function(coord) {
		// convert to absolute coords, rotate, then convert back
		return utils.rotate_coords_relative(coord, angle, 
						    center_absolute, reaction.coords);
	    };
	    var rotate_around_rel_recursive = function(coords) {
		// convert to absolute coords, rotate, then convert back, recursively
		return utils.rotate_coords_relative_recursive(coords, angle,
							      center_absolute,
							      reaction.coords);
	    };

	    // recalculate: reaction.main_axis, reaction.coords
	    reaction.coords = rotate_around(reaction.coords);
	    reaction.center = rotate_around_rel(reaction.center);
	    reaction.main_axis = rotate_around_rel_recursive(reaction.main_axis);

	    // recalculate: metabolite.*
	    for (var met_id in reaction.segments) {
		var metabolite = reaction.segments[met_id];
		metabolite.b1 = rotate_around_rel(metabolite.b1);
		metabolite.b2 = rotate_around_rel(metabolite.b2);
		metabolite.start = rotate_around_rel(metabolite.start);
		metabolite.end = rotate_around_rel(metabolite.end);
		metabolite.circle = rotate_around_rel(metabolite.circle);
	    }
	    return reaction;
        }
	

        function generate_arrowhead_for_color(color, is_end) {
            var pref;
            if (is_end) pref = 'start-';
            else        pref = 'end-';

            var id = String(color).replace('#', pref);
            if (o.arrowheads_generated.indexOf(id) < 0) {
                o.arrowheads_generated.push(id);

                var markerWidth = 5,
                    markerHeight = 5,
                    // cRadius = 0, // play with the cRadius value
                    // refX = cRadius + (markerWidth * 2),
                    // refY = -Math.sqrt(cRadius),
                    // drSub = cRadius + refY;
                    refX,
                    refY = markerWidth/2,
                    d;

                if (is_end) refX = 0;
                else        refX = markerHeight;
                if (is_end) d = 'M0,0 V'+markerWidth+' L'+markerHeight/2+','+markerWidth/2+' Z';
                else        d = 'M'+markerHeight+',0 V'+markerWidth+' L'+(markerHeight/2)+','+markerWidth/2+' Z';

                // generate defs if it doesn't exist
                var defs = o.svg.select("defs");
                if (defs.empty()) defs = o.svg.append("svg:defs");

                // make the marker
                defs.append("svg:marker")
                    .attr("id", id)
                    .attr("class", "arrowhead")
                    .attr("refX", refX)
                    .attr("refY", refY)
                    .attr("markerWidth", markerWidth)
                    .attr("markerHeight", markerHeight)
                    .attr("orient", "auto")
                    .append("svg:path")
                    .attr("d", d)
                    .style("fill", color);
            }
            return id;
        }

        function reaction_input_is_visible() {
            return (o.reaction_input.selection.style("display")!="none");
        }

        // -----------------------------------------------------------------------------------
        // KEYBOARD

        function setup_key_listeners() {
            var held_keys = reset_held_keys(),
                modifier_keys = { command: 91,
                                  control: 17,
                                  option: 18,
                                  shift: 16},
                primary_cycle_key= { key: 80 }, // 'p'
                hide_show_input_key = { key: 191 }, // forward slash '/'
                rotate_keys = {'left':  { key: 37 },
                               'right': { key: 39 },
                               'up':    { key: 38 },
                               'down':  { key: 40 } },
                control_key = { key: 17 },
                save_key = { key: 83, modifiers: { control: true } },
                load_key = { key: 79, modifiers: { control: true } },
		pan_and_zoom_key = { key: 90 },
		brush_key = { key: 86 };

            d3.select(window).on("keydown", function() {
                var kc = d3.event.keyCode,
                    reaction_input_visible = reaction_input_is_visible();

                held_keys = toggle_modifiers(modifier_keys, held_keys, kc, true);
		o.shift_key_on = held_keys.shift;
                if (check_key(primary_cycle_key, kc, held_keys) && !reaction_input_visible) {
                    cmd_cycle_primary_metabolite();
                    held_keys = reset_held_keys();
                } else if (check_key(hide_show_input_key, kc, held_keys)) {
                    cmd_hide_show_input();
                    held_keys = reset_held_keys();
                } else if (check_key(rotate_keys.left, kc, held_keys) && !reaction_input_visible) {
                    cmd_left();
                    held_keys = reset_held_keys();
                } else if (check_key(rotate_keys.right, kc, held_keys) && !reaction_input_visible) {
                    cmd_right();
                    held_keys = reset_held_keys();
                } else if (check_key(rotate_keys.up, kc, held_keys) && !reaction_input_visible) {
                    cmd_up();
                    held_keys = reset_held_keys();
                } else if (check_key(rotate_keys.down, kc, held_keys) && !reaction_input_visible) {
                    cmd_down();
                    held_keys = reset_held_keys();
                } else if (check_key(save_key, kc, held_keys) && !reaction_input_visible) {
                    held_keys = reset_held_keys();
                    cmd_save();
                } else if (check_key(load_key, kc, held_keys) && !reaction_input_visible) {
                    cmd_load();
                    held_keys = reset_held_keys();
                } else if (check_key(pan_and_zoom_key, kc, held_keys) && !reaction_input_visible) {
                    cmd_zoom_on();
                    held_keys = reset_held_keys();
                } else if (check_key(brush_key, kc, held_keys) && !reaction_input_visible) {
                    cmd_zoom_off();
                    held_keys = reset_held_keys();
                }
            }).on("keyup", function() {
                held_keys = toggle_modifiers(modifier_keys, held_keys, d3.event.keyCode, false);
		o.shift_key_on = held_keys.shift;
            });

            function reset_held_keys() {
                return { command: false,
                         control: false,
                         option: false,
                         shift: false };
            }
            function toggle_modifiers(mod, held, kc, on_off) {
                for (var k in mod)
                    if (mod[k] == kc)
                        held[k] = on_off;
                return held;
            }
            function check_key(key, pressed, held) {
                if (key.key != pressed) return false;
                var mod = key.modifiers;
                if (mod === undefined)
                    mod = { control: false,
                            command: false,
                            option: false,
                            shift: false };
                for (var k in held) {
                    if (mod[k] === undefined) mod[k] = false;
                    if (mod[k] != held[k]) return false;
                }
                return true;
            }
        }
        // Commands
        function cmd_hide_show_input() {
            if (reaction_input_is_visible()) cmd_hide_input();
            else cmd_show_input();
        }
        function cmd_hide_input() {
            o.reaction_input.selection.style("display", "none");
            o.reaction_input.completely.input.blur();
            o.reaction_input.completely.hideDropDown();
        }
        function cmd_show_input() {
            reload_reaction_input(coords_for_selected_node());
        }
        function cmd_cycle_primary_metabolite() {
            cmd_hide_input();
            cycle_primary_key();
        }
        function cmd_left() {
            cmd_hide_input();
            // rotate_reaction_id(o.selected_node.reaction_id, 'angle', 270*(Math.PI/180));
            // draw_specific_reactions_with_location(o.selected_node.reaction_id);
        }
        function cmd_right() {
            cmd_hide_input();
            // rotate_reaction_id(o.selected_node.reaction_id, 'angle', 90*(Math.PI/180));
            // draw_specific_reactions_with_location(o.selected_node.reaction_id);
        }
        function cmd_up() {
            cmd_hide_input();
            // rotate_reaction_id(o.selected_node.reaction_id, 'angle', 180*(Math.PI/180));
            // draw_specific_reactions_with_location(o.selected_node.reaction_id);
        }
        function cmd_down() {
            cmd_hide_input();
            // rotate_reaction_id(o.selected_node.reaction_id, 'angle', 0);
            // draw_specific_reactions_with_location(o.selected_node.reaction_id);
        }
        function cmd_save() {
            console.log("Saving");
            utils.download_json(o.drawn_reactions, "map");
        }
        function cmd_load() {
            console.log("Loading");
            o.load_input_click_fn();
        }
	function cmd_show_beziers() {
	    o.show_beziers = true;
	    d3.select(this).text('Hide control points')
		.on('click', cmd_hide_beziers);
	    draw();
	}
	function cmd_hide_beziers() {
	    o.show_beziers = false;
	    d3.select(this).text('Show control points')
		.on('click', cmd_show_beziers);
	    draw();
	}
	function cmd_zoom_on() {
	    o.zoom_enabled = true;
	    enable_brush(false);
	    d3.select('#zoom-button').text('Enable select (v)')
		.on('click', cmd_zoom_off);
	}
	function cmd_zoom_off() {
	    o.zoom_enabled = false;
	    enable_brush(true);
	    d3.select('#zoom-button').text('Enable pan+zoom (z)')
		.on('click', cmd_zoom_on);
	}
    };
});
