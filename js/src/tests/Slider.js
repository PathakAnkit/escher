/** Slider */

var utils = require('./utils');
var CallbackManager = require('./CallbackManager');
var _ = require('underscore');
var bootstrapSlider = require('bootstrap-slider');

var Slider = utils.make_class();

// instance methods
Slider.prototype = {
    init: init,
    is_visible: is_visible
};
module.exports = Slider;

function init(sel, map) {
    var container = sel.attr('class', 'slider-container')
        .style('display', 'none');

    this.input = container.append('input')
        .attr('id', 'slider')
        .attr('type', 'text')
        .attr('data-slider-min', '1')
        .attr('data-slider-max', '3')
        .attr('data-slider-step', '1')
        .attr('data-slider-value', '1');

    var bootstrap_slider = new bootstrapSlider("#slider", {
        tooltip: 'always'
    });

    container.append('button')
        .attr('class', 'btn btn-sm btn-default close-button')
        .on('click', function() {
            this.toggle(false);
        }.bind(this))
        .append('span').attr('class',  'glyphicon glyphicon-remove');

    this.callback_manager = new CallbackManager();

    this.selection = container;
    this.map = map;
}

function is_visible() {
    return this.selection.style('display') !== 'none';
}